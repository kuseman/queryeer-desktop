import type { Disposable } from "@queryeer/api/editor/EditorApi";
import { setDisposable, toDisposable } from "../../core/plugin-runtime/disposables";
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

  public subscribe(subscriber: JdbcDriverSubscriber): Disposable {
    // A wrapper, so the same function subscribed twice is two subscriptions
    const entry: JdbcDriverSubscriber = (drivers) => subscriber(drivers);
    this.subscribers.add(entry);
    return toDisposable(() => {
      this.subscribers.delete(entry);
    });
  }

  private registerDriver(ownerPluginId: string, contribution: JdbcManagedDriverContribution): Disposable {
    const existing = this.drivers.get(contribution.dialectId);
    if (existing && existing.ownerPluginId !== ownerPluginId) {
      throw new Error(
        `JDBC driver contribution '${contribution.dialectId}' is already registered by '${existing.ownerPluginId}'`
      );
    }
    const registered: RegisteredJdbcManagedDriverContribution = { ...contribution, ownerPluginId };
    const registration = setDisposable(this.drivers, contribution.dialectId, registered, () => this.notifySubscribers());
    this.notifySubscribers();
    return registration;
  }

  private notifySubscribers(): void {
    const drivers = this.listDrivers();
    for (const subscriber of this.subscribers) {
      subscriber(drivers);
    }
  }
}
