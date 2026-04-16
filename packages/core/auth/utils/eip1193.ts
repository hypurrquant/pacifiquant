type EIP1193ReturnType = {
  eth_requestAccounts: string[];
  eth_accounts: string[];
  eth_chainId: string;
  personal_sign: string;
  eth_sendTransaction: string;
  wallet_switchEthereumChain: void;
  wallet_addEthereumChain: void;
};

interface EIP1193RequestProvider {
  request: (args: { method: string; params: unknown[] | undefined }) => Promise<unknown>;
}

export async function requestEIP1193<M extends keyof EIP1193ReturnType>(
  provider: EIP1193RequestProvider,
  method: M,
  params: unknown[] | undefined = undefined
): Promise<EIP1193ReturnType[M]> {
  const result = await provider.request({ method, params });
  return result as EIP1193ReturnType[M]; // @ci-exception(type-assertion-count)
}
