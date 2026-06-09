import { db } from "@workspace/db";
import {
  aiModelsTable,
  trainingDatasetsTable,
  trainingSamplesTable,
  documentsTable,
  conversationsTable,
  messagesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

async function seed() {
  console.log("Seeding database...");

  // Seed models
  await db.insert(aiModelsTable).values({
    name: "NeuralCore-L1",
    type: "llm",
    version: "1.0.0",
    architecture: "tinyllama",
    description: "Local LLM model for general conversation",
    status: "active",
  });

  await db.insert(aiModelsTable).values({
    name: "Embed-Local",
    type: "embedding",
    version: "0.5.0",
    architecture: "Sentence Transformer",
    description: "Local embedding model for RAG",
    status: "active",
  });

  // ─── Dataset 1: General QA ───────────────────────────────────────────────
  const [ds1] = await db
    .insert(trainingDatasetsTable)
    .values({
      name: "General QA Dataset",
      description: "Common question-answer pairs for LLM fine-tuning",
      taskType: "qa",
      sampleCount: 0,
    })
    .returning();

  const qaSamples = [
    {
      input: "What is artificial intelligence?",
      output:
        "Artificial intelligence (AI) is the simulation of human intelligence processes by computer systems, including learning, reasoning, and self-correction.",
    },
    {
      input: "Explain machine learning in simple terms.",
      output:
        "Machine learning is a type of AI where systems learn from data to improve their performance without being explicitly programmed. Like training a dog with treats, you show the system examples and it learns patterns.",
    },
    {
      input: "What is a neural network?",
      output:
        "A neural network is a series of algorithms that loosely mimics the human brain, recognizing patterns and relationships in data through layers of interconnected nodes.",
    },
    {
      input: "What is deep learning?",
      output:
        "Deep learning is a subset of machine learning using neural networks with many layers to learn representations of data with multiple levels of abstraction.",
    },
    {
      input: "What is the difference between AI and machine learning?",
      output:
        "AI is the broad concept of machines performing tasks intelligently, while machine learning is a subset of AI where machines learn from data without explicit programming.",
    },
  ];

  await db.insert(trainingSamplesTable).values(
    qaSamples.map((s) => ({ datasetId: ds1.id, input: s.input, output: s.output }))
  );
  await db
    .update(trainingDatasetsTable)
    .set({ sampleCount: qaSamples.length })
    .where(eq(trainingDatasetsTable.id, ds1.id));

  // ─── Dataset 2: Code Generation ─────────────────────────────────────────
  const [ds2] = await db
    .insert(trainingDatasetsTable)
    .values({
      name: "Code Generation Dataset",
      description: "Programming task examples for code generation fine-tuning",
      taskType: "generation",
      sampleCount: 0,
    })
    .returning();

  const codeSamples = [
    {
      input: "Write a Python function to reverse a string",
      output:
        "def reverse_string(s):\n    return s[::-1]\n\n# Example usage\nprint(reverse_string('hello'))  # Output: 'olleh'",
    },
    {
      input: "Write a JavaScript function to check if a number is prime",
      output:
        "function isPrime(n) {\n  if (n < 2) return false;\n  for (let i = 2; i <= Math.sqrt(n); i++) {\n    if (n % i === 0) return false;\n  }\n  return true;\n}",
    },
    {
      input: "Write a SQL query to get the top 5 customers by revenue",
      output:
        "SELECT customer_id, customer_name, SUM(order_total) as total_revenue\nFROM orders JOIN customers USING (customer_id)\nGROUP BY customer_id, customer_name\nORDER BY total_revenue DESC\nLIMIT 5;",
    },
  ];

  await db.insert(trainingSamplesTable).values(
    codeSamples.map((s) => ({ datasetId: ds2.id, input: s.input, output: s.output }))
  );
  await db
    .update(trainingDatasetsTable)
    .set({ sampleCount: codeSamples.length })
    .where(eq(trainingDatasetsTable.id, ds2.id));

  // ─── Documents ───────────────────────────────────────────────────────────
  await db.insert(documentsTable).values({
    title: "AI Systems Overview",
    content:
      "AI systems are built using neural networks, transformers, and various machine learning algorithms. The core architecture typically includes an encoder, decoder, and attention mechanism. Training involves feeding large datasets and optimizing loss functions. Modern LLMs (Large Language Models) use transformer architectures with billions of parameters.",
    fileType: "text",
    size: 380,
    indexed: true,
    chunkCount: 2,
  });

  await db.insert(documentsTable).values({
    title: "RAG Architecture Guide",
    content:
      "Retrieval-Augmented Generation (RAG) combines retrieval systems with generative models. The pipeline involves: document ingestion, chunking, embedding generation, vector storage, and retrieval-augmented generation during inference. RAG improves accuracy by grounding responses in actual documents.",
    fileType: "text",
    size: 300,
    indexed: true,
    chunkCount: 2,
  });

  await db.insert(documentsTable).values({
    title: "Ollama Local AI Guide",
    content:
      "Ollama is a tool for running large language models locally. It supports models like Llama, Qwen, DeepSeek, Phi, Gemma, and more. Models are downloaded with 'ollama pull <model-name>' and run locally using quantized weights (GGUF format). This enables private, offline AI inference without cloud dependency.",
    fileType: "text",
    size: 280,
    indexed: true,
    chunkCount: 2,
  });

  // ─── Conversation ────────────────────────────────────────────────────────
  const [conv1] = await db
    .insert(conversationsTable)
    .values({ title: "Welcome to NEXUS_OS", model: "tinyllama" })
    .returning();

  await db.insert(messagesTable).values({
    conversationId: conv1.id,
    role: "system",
    content:
      "You are NEXUS_OS, a powerful local AI assistant running on Ollama. Help users with questions, code, analysis, and more.",
  });

  await db.insert(messagesTable).values({
    conversationId: conv1.id,
    role: "assistant",
    content:
      "Hello! I'm NEXUS_OS, your local AI assistant. I run entirely on your machine using Ollama — no cloud, complete privacy. How can I help you?",
  });

  console.log("Database seeded successfully!");
}

seed().catch(console.error);
