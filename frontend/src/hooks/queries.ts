import { useQueries, useQuery } from '@tanstack/react-query';
import { ApiError, apiGet } from '../api';
import { tzOffset } from '../lib/format';
import type {
  AppNotification, DeviceToken, Goal, GoalProgress, Group, GroupDetails, GroupPreview, History,
  InsightsPayload, LeaderRow, Me, Metrics, PeriodView, TimeSlot,
} from '../types';

/**
 * Every read the website makes, typed, in one place. React Query caches each
 * for 30 s (api.ts), so pages that share data share one request.
 */

/** The signed-in user, or null when signed out (a 401 is an answer, not an error). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const data = await apiGet<{ user?: Me }>('/api/user/profile');
        return data.user ?? null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });
}

const tz = () => tzOffset();

export const useDayView = (userId: string) =>
  useQuery({ queryKey: ['analytics', 'day', userId, tz()], queryFn: () => apiGet<PeriodView>(`/api/analytics/${userId}?timezone=${tz()}`) });

export const useWeekView = (userId: string) =>
  useQuery({ queryKey: ['analytics', 'week', userId, tz()], queryFn: () => apiGet<PeriodView>(`/api/analytics/weekly/${userId}?timezone=${tz()}`) });

export const useHistory = (userId: string) =>
  useQuery({ queryKey: ['analytics', 'history', userId, tz()], queryFn: () => apiGet<History>(`/api/analytics/history/${userId}?timezone=${tz()}`) });

export const useTimeSlot = (userId: string, slot: { start: number; end: number } | null) =>
  useQuery({
    queryKey: ['analytics', 'slot', userId, tz(), slot?.start, slot?.end],
    queryFn: () => apiGet<TimeSlot>(`/api/analytics/timeslot/${userId}?start=${slot!.start}&end=${slot!.end}&timezone=${tz()}`),
    enabled: slot !== null,
  });

export const useMyGroups = () =>
  useQuery({ queryKey: ['groups', 'mine'], queryFn: async () => (await apiGet<{ groups: Group[] }>('/api/groups/my-groups')).groups });

export const useDiscoverGroups = (search: string, enabled = true) =>
  useQuery({
    queryKey: ['groups', 'discover', search],
    queryFn: async () => (await apiGet<{ groups: Group[] }>(`/api/groups/discover${search ? `?search=${encodeURIComponent(search)}` : ''}`)).groups,
    enabled,
  });

export interface BoardWindow {
  from?: string;
  to?: string;
}

export function boardQuery(window: BoardWindow): string {
  const p = new URLSearchParams({ timezone: String(tz()) });
  if (window.from) p.set('from', window.from);
  if (window.to) p.set('to', window.to);
  return p.toString();
}

export const useGroupDetails = (groupId: string | undefined, window: BoardWindow) =>
  useQuery({
    queryKey: ['groups', 'details', groupId, window.from ?? null, window.to ?? null, tz()],
    queryFn: () => apiGet<GroupDetails>(`/api/groups/${groupId}/details?${boardQuery(window)}`),
    enabled: Boolean(groupId),
    placeholderData: (previous) => previous, // keep the old board while the next period loads, so rows can slide
  });

export const useGroupPreview = (groupId: string | undefined) =>
  useQuery({
    queryKey: ['groups', 'preview', groupId],
    queryFn: () => apiGet<GroupPreview>(`/api/groups/${groupId}/preview`),
    enabled: Boolean(groupId),
  });

export const useLeaderboard = (days: number | null) =>
  useQuery({
    queryKey: ['leaderboard', days],
    queryFn: () => apiGet<LeaderRow[]>(`/api/leaderboard${days ? `?days=${days}` : ''}`),
    placeholderData: (previous) => previous,
  });

export const useGoals = () => useQuery({ queryKey: ['goals'], queryFn: () => apiGet<Goal[]>('/api/goals') });

/** Progress for each goal (one small request per goal; people have a handful). */
export function useGoalProgress(goals: Goal[] | undefined) {
  return useQueries({
    queries: (goals ?? []).map((g) => ({
      queryKey: ['goals', 'progress', g._id, g.status, g.completedAt],
      queryFn: () => apiGet<GoalProgress>(`/api/goals/${g._id}/progress`),
    })),
  });
}

export const useNotifications = (enabled: boolean) =>
  useQuery({ queryKey: ['notifications'], queryFn: () => apiGet<AppNotification[]>('/api/notifications'), enabled });

export const useUnreadCount = () =>
  useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => (await apiGet<{ count: number }>('/api/notifications/unread-count')).count,
    refetchInterval: 30_000,
  });

export const useDevices = () => useQuery({ queryKey: ['devices'], queryFn: () => apiGet<DeviceToken[]>('/api/device/tokens') });

export const useMetrics = (days: number) =>
  useQuery({
    queryKey: ['metrics', days, tz()],
    queryFn: () => apiGet<{ metrics: Metrics; insights?: InsightsPayload }>(`/api/metrics?days=${days}&timezone=${tz()}`),
  });
