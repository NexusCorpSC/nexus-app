import { apiRequest } from "@/lib/api-client";
import type { Note } from "@/types/nexus";

export function getNote() {
  return apiRequest<Note>("/api/notes");
}

export function saveNote(content: string) {
  return apiRequest<Note>("/api/notes", { method: "PUT", body: { content } });
}
