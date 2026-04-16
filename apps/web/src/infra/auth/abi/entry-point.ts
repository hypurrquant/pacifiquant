export const entryPointAbi = [
    {
        "type": "function", "name": "getDepositInfo", "stateMutability": "view",
        "inputs": [{ "name": "account", "type": "address" }],
        "outputs": [
            {
                "components": [
                    { "name": "deposit", "type": "uint112" },
                    { "name": "staked", "type": "bool" },
                    { "name": "stake", "type": "uint112" },
                    { "name": "unstakeDelaySec", "type": "uint32" },
                    { "name": "withdrawTime", "type": "uint48" }
                ],
                "type": "tuple"
            }
        ]
    },
    {
        "type": "function", "name": "depositTo", "stateMutability": "payable",
        "inputs": [{ "name": "account", "type": "address" }], "outputs": []
    },
    {
        "type": "function", "name": "withdrawTo", "stateMutability": "nonpayable",
        "inputs": [{ "name": "withdrawAddress", "type": "address" }, { "name": "amount", "type": "uint256" }],
        "outputs": []
    },
    // (v0.6 구현에 있을 수 있는 balanceOf)
    {
        "type": "function", "name": "balanceOf", "stateMutability": "view",
        "inputs": [{ "name": "account", "type": "address" }], "outputs": [{ "type": "uint256" }]
    }
] as const;

// 3) 조회: 사용자의 EntryPoint 예치금(네이티브 코인 단위, 예: HYPE/ETH)
export async function getAaDepositOnEntryPoint({ publicClient, entryPointAddress, userAaAddress, }: { publicClient: any, entryPointAddress: `0x${string}`, userAaAddress: `0x${string}` }) {
    const info = await publicClient.readContract({
        address: entryPointAddress,
        abi: entryPointAbi,
        functionName: "getDepositInfo",
        args: [userAaAddress],
    });
    // info.deposit 이 현재 사용 가능한 예치금
    return info.deposit; // bigint
}
