import { z } from "zod";

// ─── Health ───────────────────────────────────────────────────────────────────
export const HealthCheckResponse = z.object({
  status: z.string(),
});

// ─── Conversations ────────────────────────────────────────────────────────────
export const CreateConversationBody = z.object({
  title: z.string(),
  model: z.string().optional(),
});

export const GetConversationParams = z.object({
  id: z.coerce.number().int(),
});

export const DeleteConversationParams = z.object({
  id: z.coerce.number().int(),
});

// ─── Messages ─────────────────────────────────────────────────────────────────
export const SendMessageBody = z.object({
  content: z.string(),
  model: z.string().optional(),
});

export const ListMessagesParams = z.object({
  id: z.coerce.number().int(),
});

export const SendMessageParams = z.object({
  id: z.coerce.number().int(),
});

// ─── Documents ────────────────────────────────────────────────────────────────
export const UploadDocumentBody = z.object({
  title: z.string(),
  content: z.string(),
  fileType: z.string().optional(),
});

export const GetDocumentParams = z.object({
  id: z.coerce.number().int(),
});

export const DeleteDocumentParams = z.object({
  id: z.coerce.number().int(),
});

export const SearchDocumentsBody = z.object({
  query: z.string(),
  topK: z.number().int().optional(),
  searchType: z.enum(["semantic", "keyword", "hybrid"]).optional(),
});

// ─── Training Datasets ────────────────────────────────────────────────────────
export const CreateTrainingDatasetBody = z.object({
  name: z.string(),
  description: z.string().optional(),
  taskType: z.enum(["classification", "generation", "summarization", "qa", "translation"]),
});

export const GetTrainingDatasetParams = z.object({
  id: z.coerce.number().int(),
});

export const AddTrainingSampleParams = z.object({
  id: z.coerce.number().int(),
});

export const AddTrainingSampleBody = z.object({
  input: z.string(),
  output: z.string().optional(),
  label: z.string().optional(),
  metadata: z.string().optional(),
});

// ─── Training Jobs ────────────────────────────────────────────────────────────
export const StartTrainingJobBody = z.object({
  modelId: z.number().int(),
  datasetId: z.number().int(),
  epochs: z.number().int().optional(),
  hyperparameters: z.string().nullable().optional(),
});

export const GetTrainingJobParams = z.object({
  id: z.coerce.number().int(),
});

// ─── AI Models ────────────────────────────────────────────────────────────────
export const RegisterModelBody = z.object({
  name: z.string(),
  type: z.enum(["llm", "embedding", "classification", "summarization", "custom"]),
  version: z.string(),
  architecture: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});
