export interface ToolRequest<T = unknown> {
  name: string;
  arguments: T;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface SearchClientsArgs {
  query: string;
  limit?: number;
}

export interface CreateClientArgs {
  name: string;
  type: 'individual' | 'sole_proprietor' | 'company';
  phone?: string;
  email?: string;
}

export interface CreateDealArgs {
  clientId: string;
  title: string;
  amount?: number;
  currency?: string;
  dueDate?: string;
}

export interface OverduePaymentsArgs {
  clientId?: string;
  asOf?: string;
}

export interface CreateTaskArgs {
  title: string;
  dueAt?: string;
  clientId?: string;
  dealId?: string;
}

export const CRM_TOOL_NAMES = [
  'crm.search_clients',
  'crm.get_client',
  'crm.create_client',
  'crm.create_deal',
  'crm.list_overdue_payments',
  'crm.create_task',
  'calendar.create_event',
  'documents.create',
  'knowledge.search',
  'web.search_official',
] as const;

export type CrmToolName = typeof CRM_TOOL_NAMES[number];

/**
 * Policy rule: the model may propose a tool call, but execution belongs to the
 * tool/policy layer. Sensitive external actions must not be silently executed.
 */
export const SENSITIVE_TOOL_PREFIXES = [
  'documents.create',
  'calendar.create_event',
];
