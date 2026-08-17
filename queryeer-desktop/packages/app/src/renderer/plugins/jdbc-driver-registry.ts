import type {
  JdbcDriverRegistry,
  JdbcDriverSubscriber,
  JdbcManagedDriverContribution,
  RegisteredJdbcManagedDriverContribution
} from "@queryeer/api/queryengine/JdbcDriverExtension";

export class JdbcDriverRegistryHost {
  private readonly drivers = new Map<string, RegisteredJdbcManagedDriverContribution>();
  private readonly subscribers = new Set<JdbcDriverSubscriber>();

  public createRegistry(ownerPluginId: string): JdbcDriverRegistry {
    return {
      registerDriver: (contribution) => this.registerDriver(ownerPluginId, contribution),
      listDrivers: () => this.listDrivers(),
      getDriver: (dialectId) => this.getDriver(dialectId),
      subscribe: (subscriber) => this.subscribe(subscriber)
    };
  }

  public listDrivers(): readonly RegisteredJdbcManagedDriverContribution[] {
    return [...this.drivers.values()];
  }

  public getDriver(dialectId: string): RegisteredJdbcManagedDriverContribution | undefined {
    return this.drivers.get(dialectId);
  }

  public subscribe(subscriber: JdbcDriverSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  private registerDriver(ownerPluginId: string, contribution: JdbcManagedDriverContribution): void {
    const existing = this.drivers.get(contribution.dialectId);
    if (existing && existing.ownerPluginId !== ownerPluginId) {
      throw new Error(
        `JDBC driver contribution '${contribution.dialectId}' is already registered by '${existing.ownerPluginId}'`
      );
    }
    this.drivers.set(contribution.dialectId, { ...contribution, ownerPluginId });
    const drivers = this.listDrivers();
    for (const subscriber of this.subscribers) {
      subscriber(drivers);
    }
  }
}
