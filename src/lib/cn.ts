import { twMerge } from "tailwind-merge";

export function cn(...inputs: Array<string | false | null | undefined>): string {
  return twMerge(inputs.filter(Boolean).join(" "));
}
