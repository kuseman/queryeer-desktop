import React from "react";
import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { ExpressionTesterRenderer } from "../core.commands/ExpressionTesterRenderer";

void React;

export const coreExpressionsPlugin: Plugin = {
  manifest: {
    id: "core.expressions",
    name: "Core Expressions",
    version: "0.1.0",
    kind: "core",
    description: "Shared expression runtime and playground",
    dependencies: ["core.settings", "core.commands"],
    requiredCapabilities: []
  },
  activate: (context) => {
    context.settings.registerAdvancedRenderer({
      id: "core.expressions.tester",
      render: (props) => <ExpressionTesterRenderer {...props} />
    });

    context.settings.registerSettings({
      moduleId: "core.expressions",
      title: "Expressions",
      settings: [
        {
          id: "core.expressions.tester.placeholder",
          moduleId: "core.expressions",
          title: "Expression Playground",
          description: "Test expressions and templates against the live context chain and selected file context.",
          sectionPath: ["Expressions", "Playground"],
          type: "json",
          defaultValue: null,
          advanced: { rendererId: "core.expressions.tester" }
        }
      ]
    });
  }
};
