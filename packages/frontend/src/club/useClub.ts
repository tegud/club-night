import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export function useClub(slug: string) {
  return useQuery({ queryKey: ['club', slug], queryFn: () => apiClient.getClub(slug) });
}

export function useNights(slug: string) {
  return useQuery({ queryKey: ['nights', slug], queryFn: () => apiClient.listNights(slug) });
}

export function useNight(slug: string, nightId: string) {
  return useQuery({ queryKey: ['night', slug, nightId], queryFn: () => apiClient.getNight(slug, nightId) });
}

export function useMySignup(slug: string, nightId: string, enabled: boolean) {
  return useQuery({ queryKey: ['my-signup', slug, nightId], queryFn: () => apiClient.getMySignup(slug, nightId), enabled });
}
