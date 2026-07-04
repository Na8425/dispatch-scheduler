export interface PageParams {
  page: number;
  pageSize: number;
}

export function parsePageParams(query: Record<string, any>): PageParams {
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '20', 10) || 20));
  return { page, pageSize };
}

export function buildPageMeta(total: number, { page, pageSize }: PageParams) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
