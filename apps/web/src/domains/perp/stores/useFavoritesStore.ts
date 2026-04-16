/**
 * Favorites Store — perp 마켓 즐겨찾기 (localStorage persist)
 */

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FavoritesStore {
  favorites: string[]; // symbol 배열
  toggleFavorite: (symbol: string) => void;
  isFavorite: (symbol: string) => boolean;
  clearAll: () => void;
}

const DEFAULT_FAVORITES = ['BTC', 'ETH', 'SOL', 'HYPE'];

export const useFavoritesStore = create<FavoritesStore>()(
  persist(
    (set, get) => ({
      favorites: DEFAULT_FAVORITES,

      toggleFavorite: (symbol) => {
        const current = get().favorites;
        if (current.includes(symbol)) {
          set({ favorites: current.filter(s => s !== symbol) });
        } else {
          set({ favorites: [...current, symbol] });
        }
      },

      isFavorite: (symbol) => get().favorites.includes(symbol),

      clearAll: () => set({ favorites: [] }),
    }),
    {
      name: 'hq-perp-favorites',
    },
  ),
);
