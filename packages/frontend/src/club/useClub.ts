import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export function useClub(slug: string) {
  return useQuery({ queryKey: ['club', slug], queryFn: () => apiClient.getClub(slug) });
}

export function useNights(slug: string) {
  return useQuery({ queryKey: ['nights', slug], queryFn: () => apiClient.listNights(slug) });
}
