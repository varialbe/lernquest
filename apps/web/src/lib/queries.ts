import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DuelsResponse, LeaderboardResponse, MasteryResponse, MeResponse, PathResponse, ProfileResponse, QuestsResponse, ShopItem } from '@lernquest/shared';
import { api } from './api.ts';

export const useMe = (enabled = true) => useQuery({ queryKey: ['me'], queryFn: () => api<MeResponse>('/api/me'), enabled, staleTime: 15_000 });
export const usePath = () => useQuery({ queryKey: ['path'], queryFn: () => api<PathResponse>('/api/path'), staleTime: 30_000 });
export const useConfig = () =>
  useQuery({ queryKey: ['config'], queryFn: () => api<{ sourceLinkBase: string; vapidPublicKey: string | null }>('/api/config'), staleTime: Infinity });
export const useShop = () => useQuery({ queryKey: ['shop'], queryFn: () => api<{ items: ShopItem[] }>('/api/shop'), staleTime: Infinity });
export const useLeaderboard = (kind: string) => useQuery({ queryKey: ['lb', kind], queryFn: () => api<LeaderboardResponse>(`/api/leaderboard/${kind}`), staleTime: 20_000 });
export const useProfile = (username = 'me') => useQuery({ queryKey: ['profile', username], queryFn: () => api<ProfileResponse>(`/api/profile/${username}`) });
export const useMastery = () => useQuery({ queryKey: ['mastery'], queryFn: () => api<MasteryResponse>('/api/mastery'), staleTime: 30_000 });
export const useQuests = () => useQuery({ queryKey: ['quests'], queryFn: () => api<QuestsResponse>('/api/quests'), staleTime: 15_000 });
export const useDuels = () => useQuery({ queryKey: ['duels'], queryFn: () => api<DuelsResponse>('/api/duels'), staleTime: 10_000, refetchInterval: 60_000 });

/** Module-Auswahl, über Seiten hinweg gemerkt */
export const savedModule = () => {
  try {
    return (localStorage.getItem('lq.module') as 'DS' | 'EIP' | 'ERA' | null) || 'DS';
  } catch {
    return 'DS';
  }
};

/** Mutation, die danach die Nutzerdaten im Cache ersetzt. */
export function useMeMutation<TVars>(fn: (v: TVars) => Promise<MeResponse>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (me) => {
      qc.setQueryData(['me'], me);
      void qc.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
