export const pluginModule = {
  manifest: {
    id: "dev.classpath.probe",
    name: "Dev Classpath Probe",
    version: "0.1.0",
    kind: "feature",
    description: "Developer plugin for backend.classpath loading verification",
    providesCapabilities: ["dev.classpath.probe"],
    requiredCapabilities: []
  },
  plugin: {
    manifest: {
      id: "dev.classpath.probe",
      name: "Dev Classpath Probe",
      version: "0.1.0",
      kind: "feature",
      description: "Developer plugin for backend.classpath loading verification",
      providesCapabilities: ["dev.classpath.probe"],
      requiredCapabilities: []
    },
    activate: () => {
      // no-op, backend loading is the target for this probe
    }
  }
};
