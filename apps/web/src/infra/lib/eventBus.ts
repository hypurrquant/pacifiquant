// Event Bus for inter-store communication
// Zustand 스토어 간 순환 의존성 해결용 동기식 pub/sub

type EventHandler = () => void;

class StoreEventBus {
  private handlers: Map<string, EventHandler[]> = new Map();

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
    return () => this.off(event, handler);
  }

  off(event: string, handler: EventHandler) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      this.handlers.set(
        event,
        handlers.filter((h) => h !== handler)
      );
    }
  }

  emit(event: string) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach((h) => h());
    }
  }
}

export const storeEvents = new StoreEventBus();
