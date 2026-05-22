import type { GraphDocument } from "../../contracts/graph";

export function createSampleGraphDocument(): GraphDocument {
  return {
    id: "core.graph.sample",
    title: "Sample Graph Document",
    description: "A fake graph document used to verify the core.graph renderer and contract.",
    layout: {
      direction: "right-left",
      rankSpacing: 110,
      nodeSpacing: 80
    },
    vertices: [
      {
        id: "select",
        label: "SELECT",
        kind: "operator",
        description: "Root query operator",
        style: {
          shape: "rounded",
          backgroundColor: "#172554",
          borderColor: "#60a5fa"
        },
        properties: [
          {
            id: "operator",
            label: "Operator",
            properties: [
              { id: "physical", label: "Physical", value: "SELECT", important: true },
              { id: "estimatedCost", label: "Estimated cost", value: 0.18, important: true }
            ]
          }
        ],
        actions: [{ id: "copy-id", label: "Copy vertex id" }]
      },
      {
        id: "hash-match",
        label: "Hash Match",
        kind: "join",
        description: "Inner join",
        style: {
          shape: "rounded",
          backgroundColor: "#312e81",
          borderColor: "#a78bfa"
        },
        properties: [
          {
            id: "estimates",
            label: "Estimates",
            properties: [
              { id: "rows", label: "Estimated rows", value: 128, important: true },
              { id: "cost", label: "Estimated cost", value: 0.14, important: true }
            ]
          },
          {
            id: "predicate",
            label: "Predicate",
            properties: [
              { id: "join", label: "Join", value: "orders.customer_id = customers.id" }
            ]
          }
        ]
      },
      {
        id: "orders-seek",
        label: "Index Seek",
        kind: "access",
        description: "Orders.IX_orders_customer_id",
        style: {
          shape: "rounded",
          backgroundColor: "#064e3b",
          borderColor: "#34d399"
        },
        properties: [
          {
            id: "object",
            label: "Object",
            properties: [
              { id: "table", label: "Table", value: "dbo.orders", important: true },
              { id: "index", label: "Index", value: "IX_orders_customer_id", important: true }
            ]
          }
        ]
      },
      {
        id: "customers-scan",
        label: "Clustered Index Scan",
        kind: "access",
        description: "Customers.PK_customers",
        style: {
          shape: "rounded",
          backgroundColor: "#7c2d12",
          borderColor: "#fb923c"
        },
        properties: [
          {
            id: "object",
            label: "Object",
            properties: [
              { id: "table", label: "Table", value: "dbo.customers", important: true },
              { id: "warning", label: "Warning", value: "Scan used for demo", important: true }
            ]
          }
        ]
      }
    ],
    edges: [
      {
        id: "select-hash",
        sourceVertexId: "hash-match",
        targetVertexId: "select",
        label: "rows",
        style: { shape: "smoothstep", width: 2, color: "#93c5fd", markerEnd: "arrow" },
        properties: [
          {
            id: "flow",
            label: "Flow",
            properties: [{ id: "rows", label: "Rows", value: 128, important: true }]
          }
        ]
      },
      {
        id: "orders-hash",
        sourceVertexId: "orders-seek",
        targetVertexId: "hash-match",
        label: "build",
        style: { shape: "smoothstep", width: 3, color: "#34d399", markerEnd: "arrow" }
      },
      {
        id: "customers-hash",
        sourceVertexId: "customers-scan",
        targetVertexId: "hash-match",
        label: "probe",
        style: { shape: "smoothstep", width: 2, color: "#fb923c", markerEnd: "arrow", dash: true }
      }
    ]
  };
}
