$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class CanvasSecretApi {
  const uint CRED_TYPE_GENERIC = 1;
  const uint CRED_PERSIST_LOCAL_MACHINE = 2;

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredRead(string target, uint type, uint reservedFlag, out IntPtr credential);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CredDelete(string target, uint type, uint reservedFlag);

  [DllImport("advapi32.dll", SetLastError = true)]
  public static extern void CredFree(IntPtr cred);

  [StructLayout(LayoutKind.Sequential)]
  public struct DATA_BLOB {
    public uint cbData;
    public IntPtr pbData;
  }

  [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CryptProtectData(
    ref DATA_BLOB pDataIn,
    string szDataDescr,
    IntPtr pOptionalEntropy,
    IntPtr pvReserved,
    IntPtr pPromptStruct,
    uint dwFlags,
    ref DATA_BLOB pDataOut);

  [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool CryptUnprotectData(
    ref DATA_BLOB pDataIn,
    IntPtr ppszDataDescr,
    IntPtr pOptionalEntropy,
    IntPtr pvReserved,
    IntPtr pPromptStruct,
    uint dwFlags,
    ref DATA_BLOB pDataOut);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern IntPtr LocalFree(IntPtr hMem);

  static byte[] ReadExact(Stream input, int count) {
    byte[] buf = new byte[count];
    int off = 0;
    while (off < count) {
      int read = input.Read(buf, off, count - off);
      if (read <= 0) {
        throw new EndOfStreamException();
      }
      off += read;
    }
    return buf;
  }

  static uint ReadU32(Stream input) {
    byte[] raw = ReadExact(input, 4);
    return (uint)(raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24));
  }

  static void WriteFrame(Stream output, byte status, byte[] data) {
    output.WriteByte(status);
    uint len = data == null ? 0u : (uint)data.Length;
    output.WriteByte((byte)(len & 0xff));
    output.WriteByte((byte)((len >> 8) & 0xff));
    output.WriteByte((byte)((len >> 16) & 0xff));
    output.WriteByte((byte)((len >> 24) & 0xff));
    if (data != null && data.Length > 0) {
      output.Write(data, 0, data.Length);
    }
    output.Flush();
  }

  static void WriteCred(string target, byte[] blob) {
    CREDENTIAL cred = new CREDENTIAL();
    cred.Flags = 0;
    cred.Type = CRED_TYPE_GENERIC;
    cred.TargetName = target;
    cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
    cred.UserName = "CanvasApp";
    cred.CredentialBlobSize = (uint)blob.Length;
    cred.CredentialBlob = blob.Length == 0 ? IntPtr.Zero : Marshal.AllocHGlobal(blob.Length);
    try {
      if (blob.Length > 0) {
        Marshal.Copy(blob, 0, cred.CredentialBlob, blob.Length);
      }
      if (!CredWrite(ref cred, 0)) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      }
    } finally {
      if (cred.CredentialBlob != IntPtr.Zero) {
        Marshal.FreeHGlobal(cred.CredentialBlob);
      }
    }
  }

  static byte[] ReadCred(string target) {
    IntPtr pcred;
    if (!CredRead(target, CRED_TYPE_GENERIC, 0, out pcred)) {
      int err = Marshal.GetLastWin32Error();
      if (err == 1168) {
        return null;
      }
      throw new System.ComponentModel.Win32Exception(err);
    }
    try {
      CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(pcred, typeof(CREDENTIAL));
      int size = checked((int)cred.CredentialBlobSize);
      if (size == 0 || cred.CredentialBlob == IntPtr.Zero) {
        return new byte[0];
      }
      byte[] blob = new byte[size];
      Marshal.Copy(cred.CredentialBlob, blob, 0, size);
      return blob;
    } finally {
      CredFree(pcred);
    }
  }

  static void DeleteCred(string target) {
    if (!CredDelete(target, CRED_TYPE_GENERIC, 0)) {
      int err = Marshal.GetLastWin32Error();
      if (err == 1168) {
        return;
      }
      throw new System.ComponentModel.Win32Exception(err);
    }
  }

  static byte[] Protect(byte[] plain) {
    DATA_BLOB input = new DATA_BLOB();
    DATA_BLOB outputBlob = new DATA_BLOB();
    input.cbData = (uint)plain.Length;
    input.pbData = plain.Length == 0 ? IntPtr.Zero : Marshal.AllocHGlobal(plain.Length);
    try {
      if (plain.Length > 0) {
        Marshal.Copy(plain, 0, input.pbData, plain.Length);
      }
      bool ok = CryptProtectData(ref input, "CanvasApp", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref outputBlob);
      if (!ok) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      }
      byte[] cipher = new byte[outputBlob.cbData];
      if (outputBlob.cbData > 0 && outputBlob.pbData != IntPtr.Zero) {
        Marshal.Copy(outputBlob.pbData, cipher, 0, (int)outputBlob.cbData);
      }
      return cipher;
    } finally {
      if (input.pbData != IntPtr.Zero) {
        Marshal.FreeHGlobal(input.pbData);
      }
      if (outputBlob.pbData != IntPtr.Zero) {
        LocalFree(outputBlob.pbData);
      }
    }
  }

  static byte[] Unprotect(byte[] cipher) {
    DATA_BLOB input = new DATA_BLOB();
    DATA_BLOB outputBlob = new DATA_BLOB();
    input.cbData = (uint)cipher.Length;
    input.pbData = cipher.Length == 0 ? IntPtr.Zero : Marshal.AllocHGlobal(cipher.Length);
    try {
      if (cipher.Length > 0) {
        Marshal.Copy(cipher, 0, input.pbData, cipher.Length);
      }
      bool ok = CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref outputBlob);
      if (!ok) {
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      }
      byte[] plain = new byte[outputBlob.cbData];
      if (outputBlob.cbData > 0 && outputBlob.pbData != IntPtr.Zero) {
        Marshal.Copy(outputBlob.pbData, plain, 0, (int)outputBlob.cbData);
      }
      return plain;
    } finally {
      if (input.pbData != IntPtr.Zero) {
        Marshal.FreeHGlobal(input.pbData);
      }
      if (outputBlob.pbData != IntPtr.Zero) {
        LocalFree(outputBlob.pbData);
      }
    }
  }

  public static void Run() {
    Stream input = Console.OpenStandardInput();
    Stream output = Console.OpenStandardOutput();
    try {
      int op = input.ReadByte();
      if (op < 0) {
        throw new EndOfStreamException();
      }
      uint nameLen = ReadU32(input);
      string name = Encoding.UTF8.GetString(ReadExact(input, checked((int)nameLen)));
      uint dataLen = ReadU32(input);
      byte[] data = dataLen == 0 ? new byte[0] : ReadExact(input, checked((int)dataLen));
      if (op == 1) {
        WriteCred(name, data);
        WriteFrame(output, 0, new byte[0]);
      } else if (op == 2) {
        byte[] blob = ReadCred(name);
        if (blob == null) {
          WriteFrame(output, 1, new byte[0]);
        } else {
          WriteFrame(output, 0, blob);
        }
      } else if (op == 3) {
        DeleteCred(name);
        WriteFrame(output, 0, new byte[0]);
      } else if (op == 4) {
        WriteFrame(output, 0, Protect(data));
      } else if (op == 5) {
        WriteFrame(output, 0, Unprotect(data));
      } else {
        WriteFrame(output, 2, new byte[0]);
      }
    } catch {
      try {
        WriteFrame(output, 2, new byte[0]);
      } catch {
      }
    }
  }
}
'@
[CanvasSecretApi]::Run()
