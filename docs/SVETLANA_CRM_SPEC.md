# Svetlana — Мир Самозанятых / Svetlana Phone

## Purpose
Specialized AI layer for Russian self-employed users. The model handles language, reasoning, domain behavior and tool use. Current laws, personal data and live records remain outside model weights.

## Domains
- Russian self-employment and NPD
- Tax and official-source navigation
- Documents and business communication
- CRM and customer management
- Calendar and tasks
- Web/search and knowledge retrieval
- Phone/Android agent through MCP and Hands

## CRM entities
Client, Lead, Deal, Service, Task, Payment, Document, CalendarEvent, Note, Interaction.

## Relationships
Client -> Deal -> Document / Payment / Task / CalendarEvent.
Lead -> Client after qualification.
Service -> Deal.

## AI rule
Never put customer-specific personal data, secrets, tokens, payment credentials or private documents into training weights. The model learns how to operate CRM tools; runtime data is retrieved through authorized tools.

## Knowledge rule
Training provides domain competence. A versioned knowledge base and live search provide current legislation and official information. For time-sensitive legal or tax questions, prefer primary official sources and expose source/date metadata.

## Tool direction
crm.search_clients
crm.get_client
crm.create_client
crm.create_deal
crm.list_overdue_payments
crm.create_task
calendar.create_event
documents.create
knowledge.search
web.search_official

Sensitive operations require policy evaluation and, where applicable, explicit user confirmation.

## Agent loop
user -> Svetlana model -> planner/tool decision -> policy -> tool -> verification -> response

Phone loop:
Svetlana -> Orchestrator -> Planner -> Policy -> Tool Registry -> Hands -> Android -> Verification -> Svetlana

## First MVP
- CRM data model and tool contracts
- seed training examples
- separate evaluation set
- Unsloth training notebook
- knowledge-base ingestion contract
- no real customer data
- no production secrets

## Evidence standard
Every implementation claim must distinguish VERIFIED, NOT PROVEN and PENDING. Static code presence is not runtime proof.