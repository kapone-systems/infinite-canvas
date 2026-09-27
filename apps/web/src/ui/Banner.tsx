import type { ReactElement } from "react";
import { COPY } from "./copy.ts";

type BannerTone = "info" | "danger";

export function Banner(props: {
  text: string;
  tone?: BannerTone;
}): ReactElement {
  const tone = props.tone ?? "info";
  return (
    <div className={`banner banner-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {props.text}
    </div>
  );
}

export function DisconnectBanner(): ReactElement {
  return <Banner text={COPY.backendDisconnected} tone="danger" />;
}
