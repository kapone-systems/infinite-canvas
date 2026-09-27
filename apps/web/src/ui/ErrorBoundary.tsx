import { Component, type ErrorInfo, type ReactNode } from "react";
import { DisconnectedPage } from "./DisconnectedPage.tsx";

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    /* 不把堆栈当主界面 */
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <DisconnectedPage
          onRetry={() => {
            this.setState({ failed: false });
          }}
        />
      );
    }
    return this.props.children;
  }
}
