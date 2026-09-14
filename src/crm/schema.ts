export type ID = string;

export interface Client {
  id: ID;
  name: string;
  type: 'individual' | 'sole_proprietor' | 'company';
  phone?: string;
  email?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Lead {
  id: ID;
  name: string;
  source?: string;
  status: 'new' | 'qualified' | 'lost' | 'converted';
  clientId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface Deal {
  id: ID;
  clientId: ID;
  serviceId?: ID;
  title: string;
  status: 'new' | 'proposal' | 'contract' | 'in_progress' | 'completed' | 'cancelled';
  amount?: number;
  currency: string;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: ID;
  name: string;
  description?: string;
  defaultPrice?: number;
  currency: string;
}

export interface Task {
  id: ID;
  title: string;
  status: 'todo' | 'in_progress' | 'done' | 'cancelled';
  dueAt?: string;
  clientId?: ID;
  dealId?: ID;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: ID;
  clientId: ID;
  dealId?: ID;
  amount: number;
  currency: string;
  status: 'expected' | 'received' | 'overdue' | 'cancelled';
  dueAt?: string;
  receivedAt?: string;
}

export interface DocumentRecord {
  id: ID;
  clientId?: ID;
  dealId?: ID;
  type: 'contract' | 'act' | 'invoice' | 'letter' | 'application' | 'other';
  title: string;
  storageRef: string;
  createdAt: string;
}

export interface CalendarEvent {
  id: ID;
  title: string;
  startsAt: string;
  endsAt?: string;
  clientId?: ID;
  dealId?: ID;
  reminderMinutes?: number;
}

export interface Note {
  id: ID;
  text: string;
  clientId?: ID;
  dealId?: ID;
  createdAt: string;
}

export interface Interaction {
  id: ID;
  clientId: ID;
  channel: 'phone' | 'email' | 'messenger' | 'meeting' | 'note' | 'system';
  summary: string;
  occurredAt: string;
}
