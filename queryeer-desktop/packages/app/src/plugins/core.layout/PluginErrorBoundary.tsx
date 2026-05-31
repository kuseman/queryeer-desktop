import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type PluginErrorBoundaryProps = {
  children: ReactNode;
  pluginId?: string;
  pluginName?: string;
};

type PluginErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: null };
  }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const name = this.props.pluginName ?? this.props.pluginId ?? "unknown";
    console.error(`[PluginErrorBoundary] Error in plugin '${name}':`, error.message, errorInfo.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      const name = this.props.pluginName ?? this.props.pluginId ?? "Plugin";
      return (
        <div className="plugin-error-boundary">
          <p className="plugin-error-boundary-title">Plugin error: {name}</p>
          <p className="plugin-error-boundary-message">{this.state.errorMessage}</p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PluginErrorBoundary;
