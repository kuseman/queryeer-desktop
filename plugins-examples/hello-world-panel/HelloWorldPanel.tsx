import { useCallback } from "react";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import helloWorldStyles from "./hello-world.css";

const STYLE_ID = "example-hello-world-styles";
const GREET_COMMAND_ID = "example.hello-world.greet";

export function injectHelloWorldStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = helloWorldStyles;
  document.head.appendChild(style);
}

export function HelloWorldPanel({ context }: { context: PluginContext }) {
  const handleClick = useCallback(() => {
    void context.commands.executeCommand(GREET_COMMAND_ID);
  }, [context]);

  return (
    <div className="hello-world-panel">
      <h3>Hello World</h3>
      <p>
        This panel is contributed by the <code>example.hello-world</code> plugin.
        It demonstrates the most common contribution types:
      </p>
      <ul>
        <li><strong>View</strong> — this panel itself</li>
        <li><strong>Command</strong> — run "Hello World: Greet" from the command palette</li>
        <li><strong>Tooltip</strong> — hover any file tab to see a Hello World section</li>
      </ul>
      <button onClick={handleClick}>Say Hello</button>
    </div>
  );
}
