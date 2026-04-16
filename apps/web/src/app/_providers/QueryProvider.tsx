"use client";

import React, { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { queryPersister } from "@/shared/lib/react-query/persister";

// Create a client with error handling
const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            throwOnError: false,
        },
    },
});

// v0.29.6: localStorage persist (non-blocking)
if (typeof window !== 'undefined') {
    persistQueryClient({
        queryClient,
        persister: queryPersister,
        maxAge: 24 * 60 * 60 * 1000,
        buster: 'v0.33.0',
        dehydrateOptions: {
            shouldDehydrateQuery: (query) => {
                return query.state.status === 'success'
                    && query.queryKey[0] === 'sdk';
            },
        },
    });
}

export function QueryProvider({ children }: PropsWithChildren) {
    return (
        <QueryClientProvider client={queryClient}>
            {children}
        </QueryClientProvider>
    );
}
