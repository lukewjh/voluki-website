export const readJsonBody = async (request: Request) => {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    throw new Error("Request body is empty");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error("Request body is not valid JSON");
  }
};

export const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Unexpected request error";
