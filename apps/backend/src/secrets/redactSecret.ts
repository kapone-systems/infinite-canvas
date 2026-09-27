/** 写入任务库、事件或错误句之前打掉密钥正文。 */
export function redactSecret(message: string, secret: Uint8Array | null): string {
  if (secret === null || secret.byteLength === 0 || message.length === 0) {
    return message;
  }
  const text = new TextDecoder().decode(secret);
  if (text.length === 0 || !message.includes(text)) {
    return message;
  }
  const stripped = message.split(text).join("");
  return stripped;
}
