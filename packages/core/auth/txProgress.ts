type TxProgressEvent =
  | { phase: 'signing' }
  | { phase: 'confirming'; hash: `0x${string}` }
  | { phase: 'done'; hash: `0x${string}` }
  | { phase: 'error'; hash: `0x${string}` | undefined };

export type TxProgressCallback = (event: TxProgressEvent) => void;
