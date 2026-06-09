import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
} from "@tanstack/react-query";

const BASE = typeof window !== "undefined"
  ? (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") ?? ""
  : "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: string;
}

export interface Conversation {
  id: number;
  title: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface Message {
  id: number;
  conversationId: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  tokens?: number | null;
}

export interface ConversationDetail {
  id: number;
  title: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

export interface Document {
  id: number;
  title: string;
  content?: string;
  fileType?: string;
  size?: number;
  createdAt: string;
  indexed: boolean;
  chunkCount: number;
}

export interface SearchResult {
  documentId: number;
  title: string;
  content: string;
  score: number;
  rank: number;
}

export interface TrainingDataset {
  id: number;
  name: string;
  description?: string | null;
  taskType: "classification" | "generation" | "summarization" | "qa" | "translation";
  sampleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingSample {
  id: number;
  datasetId: number;
  input: string;
  output?: string | null;
  label?: string | null;
  metadata?: string | null;
  createdAt: string;
}

export interface TrainingDatasetDetail extends TrainingDataset {
  samples: TrainingSample[];
}

export interface TrainingJob {
  id: number;
  modelId: number;
  datasetId: number;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
  epochs: number;
  currentEpoch: number;
  loss?: number | null;
  accuracy?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
}

export interface AiModel {
  id: number;
  name: string;
  type: "llm" | "embedding" | "classification" | "summarization" | "custom";
  status: "active" | "training" | "inactive";
  version: string;
  architecture?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalConversations: number;
  totalMessages: number;
  totalDocuments: number;
  totalModels: number;
  activeTrainingJobs: number;
  totalDatasets: number;
  systemStatus: string;
  lastUpdated: string;
}

export interface Activity {
  id: number;
  type: "conversation" | "document" | "training" | "model";
  title: string;
  description: string;
  createdAt: string;
}

// ─── Query Key Factories ──────────────────────────────────────────────────────

export const getListConversationsQueryKey = () => ["/api/conversations"] as const;
export const getGetConversationQueryKey = (id: number) => ["/api/conversations", id] as const;
export const getListMessagesQueryKey = (id: number) => ["/api/conversations", id, "messages"] as const;

export const getListDocumentsQueryKey = () => ["/api/documents"] as const;
export const getGetDocumentQueryKey = (id: number) => ["/api/documents", id] as const;

export const getListTrainingDatasetsQueryKey = () => ["/api/training-datasets"] as const;
export const getGetTrainingDatasetQueryKey = (id: number) => ["/api/training-datasets", id] as const;
export const getListTrainingJobsQueryKey = () => ["/api/training-jobs"] as const;
export const getGetTrainingJobQueryKey = (id: number) => ["/api/training-jobs", id] as const;
export const getListModelsQueryKey = () => ["/api/ai-models"] as const;

export const getDashboardStatsQueryKey = () => ["/api/dashboard/stats"] as const;
export const getRecentActivityQueryKey = () => ["/api/dashboard/recent-activity"] as const;

// ─── Orval-compatible option wrappers ────────────────────────────────────────
// Pages pass options as { mutation: {...} } or { query: {...} } (orval style).
// These helpers extract the inner options so hooks stay compatible.

type MutationOpts<TData, TErr, TVar> = {
  mutation?: Partial<UseMutationOptions<TData, TErr, TVar>>;
};

type QueryOpts<TData> = {
  query?: Partial<UseQueryOptions<TData>>;
};

// ─── Health ───────────────────────────────────────────────────────────────────

export function useHealthCheck(options?: QueryOpts<HealthStatus>) {
  return useQuery<HealthStatus>({
    queryKey: ["/api/healthz"],
    queryFn: () => apiFetch("/api/healthz"),
    ...options?.query,
  });
}

// ─── Conversations ────────────────────────────────────────────────────────────

export function useListConversations(options?: QueryOpts<Conversation[]>) {
  return useQuery<Conversation[]>({
    queryKey: getListConversationsQueryKey(),
    queryFn: () => apiFetch("/api/conversations"),
    ...options?.query,
  });
}

export function useGetConversation(id: number, options?: QueryOpts<ConversationDetail>) {
  return useQuery<ConversationDetail>({
    queryKey: getGetConversationQueryKey(id),
    queryFn: () => apiFetch(`/api/conversations/${id}`),
    enabled: !!id,
    ...options?.query,
  });
}

export function useCreateConversation(
  options?: MutationOpts<Conversation, Error, { data: { title: string; model?: string } }>
) {
  return useMutation<Conversation, Error, { data: { title: string; model?: string } }>({
    mutationFn: ({ data }) =>
      apiFetch("/api/conversations", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

export function useDeleteConversation(
  options?: MutationOpts<void, Error, { id: number }>
) {
  return useMutation<void, Error, { id: number }>({
    mutationFn: ({ id }) =>
      apiFetch(`/api/conversations/${id}`, { method: "DELETE" }),
    ...options?.mutation,
  });
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export function useListMessages(conversationId: number, options?: QueryOpts<Message[]>) {
  return useQuery<Message[]>({
    queryKey: getListMessagesQueryKey(conversationId),
    queryFn: () => apiFetch(`/api/conversations/${conversationId}/messages`),
    enabled: !!conversationId,
    ...options?.query,
  });
}

export function useSendMessage(
  conversationId: number,
  options?: MutationOpts<Message, Error, { data: { content: string; model?: string } }>
) {
  return useMutation<Message, Error, { data: { content: string; model?: string } }>({
    mutationFn: ({ data }) =>
      apiFetch(`/api/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

// ─── Documents ────────────────────────────────────────────────────────────────

export function useListDocuments(options?: QueryOpts<Document[]>) {
  return useQuery<Document[]>({
    queryKey: getListDocumentsQueryKey(),
    queryFn: () => apiFetch("/api/documents"),
    ...options?.query,
  });
}

export function useGetDocument(id: number, options?: QueryOpts<Document>) {
  return useQuery<Document>({
    queryKey: getGetDocumentQueryKey(id),
    queryFn: () => apiFetch(`/api/documents/${id}`),
    enabled: !!id,
    ...options?.query,
  });
}

export function useUploadDocument(
  options?: MutationOpts<Document, Error, { data: { title: string; content: string; fileType?: string } }>
) {
  return useMutation<Document, Error, { data: { title: string; content: string; fileType?: string } }>({
    mutationFn: ({ data }) =>
      apiFetch("/api/documents", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

export function useDeleteDocument(
  options?: MutationOpts<void, Error, { id: number }>
) {
  return useMutation<void, Error, { id: number }>({
    mutationFn: ({ id }) =>
      apiFetch(`/api/documents/${id}`, { method: "DELETE" }),
    ...options?.mutation,
  });
}

export function useSearchDocuments(
  options?: MutationOpts<SearchResult[], Error, { data: { query: string; topK?: number; searchType?: "semantic" | "keyword" | "hybrid" } }>
) {
  return useMutation<SearchResult[], Error, { data: { query: string; topK?: number; searchType?: "semantic" | "keyword" | "hybrid" } }>({
    mutationFn: ({ data }) =>
      apiFetch("/api/documents/search", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

// ─── Training Datasets ────────────────────────────────────────────────────────

export function useListTrainingDatasets(options?: QueryOpts<TrainingDataset[]>) {
  return useQuery<TrainingDataset[]>({
    queryKey: getListTrainingDatasetsQueryKey(),
    queryFn: () => apiFetch("/api/training-datasets"),
    ...options?.query,
  });
}

export function useGetTrainingDataset(id: number, options?: QueryOpts<TrainingDatasetDetail>) {
  return useQuery<TrainingDatasetDetail>({
    queryKey: getGetTrainingDatasetQueryKey(id),
    queryFn: () => apiFetch(`/api/training-datasets/${id}`),
    enabled: !!id,
    ...options?.query,
  });
}

export function useCreateTrainingDataset(
  options?: MutationOpts<TrainingDataset, Error, { data: { name: string; description?: string; taskType: string } }>
) {
  return useMutation<TrainingDataset, Error, { data: { name: string; description?: string; taskType: string } }>({
    mutationFn: ({ data }) =>
      apiFetch("/api/training-datasets", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

export function useAddTrainingSample(
  options?: MutationOpts<TrainingSample, Error, { id: number; data: { input: string; output?: string; label?: string; metadata?: string } }>
) {
  return useMutation<TrainingSample, Error, { id: number; data: { input: string; output?: string; label?: string; metadata?: string } }>({
    mutationFn: ({ id, data }) =>
      apiFetch(`/api/training-datasets/${id}/samples`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

// ─── Training Jobs ────────────────────────────────────────────────────────────

export function useListTrainingJobs(options?: QueryOpts<TrainingJob[]>) {
  return useQuery<TrainingJob[]>({
    queryKey: getListTrainingJobsQueryKey(),
    queryFn: () => apiFetch("/api/training-jobs"),
    ...options?.query,
  });
}

export function useGetTrainingJob(id: number, options?: QueryOpts<TrainingJob>) {
  return useQuery<TrainingJob>({
    queryKey: getGetTrainingJobQueryKey(id),
    queryFn: () => apiFetch(`/api/training-jobs/${id}`),
    enabled: !!id,
    ...options?.query,
  });
}

export function useStartTrainingJob(
  options?: MutationOpts<TrainingJob, Error, { data: { modelId: number; datasetId: number; epochs?: number; hyperparameters?: string | null } }>
) {
  return useMutation<TrainingJob, Error, { data: { modelId: number; datasetId: number; epochs?: number; hyperparameters?: string | null } }>({
    mutationFn: ({ data }) =>
      apiFetch("/api/training-jobs", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

// ─── AI Models ────────────────────────────────────────────────────────────────

export function useListModels(options?: QueryOpts<AiModel[]>) {
  return useQuery<AiModel[]>({
    queryKey: getListModelsQueryKey(),
    queryFn: () => apiFetch("/api/ai-models"),
    ...options?.query,
  });
}

export function useRegisterModel(
  options?: MutationOpts<AiModel, Error, { data: { name: string; type: string; version: string; architecture?: string | null; description?: string | null } }>
) {
  return useMutation<AiModel, Error, { data: { name: string; type: string; version: string; architecture?: string | null; description?: string | null } }>({
    mutationFn: ({ data }) =>
      apiFetch("/api/ai-models", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    ...options?.mutation,
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function useGetDashboardStats(options?: QueryOpts<DashboardStats>) {
  return useQuery<DashboardStats>({
    queryKey: getDashboardStatsQueryKey(),
    queryFn: () => apiFetch("/api/dashboard/stats"),
    ...options?.query,
  });
}

export function useGetRecentActivity(options?: QueryOpts<Activity[]>) {
  return useQuery<Activity[]>({
    queryKey: getRecentActivityQueryKey(),
    queryFn: () => apiFetch("/api/dashboard/recent-activity"),
    ...options?.query,
  });
}
