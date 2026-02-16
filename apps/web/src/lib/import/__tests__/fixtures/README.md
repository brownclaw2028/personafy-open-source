# Real Export Fixture Packs

These fixtures model realistic export shapes for source adapters.

- `chatgpt/wrapped-conversations.json`: Wrapped conversation arrays with linear `messages`.
- `claude/legacy-conversations.json`: Legacy conversation arrays with `role` + structured `content`.
- `notion/Workspace/*.md|*.csv`: Mixed Notion markdown/database exports.
- `gmail/Takeout/Mail/All mail Including Spam and Trash.mbox`: Gmail Takeout MBOX payload.
- `amazon/Retail.OrderHistory.1.csv`: Amazon order history CSV payload.

The fixture-driven tests in `apps/web/src/lib/import/__tests__/real-export-fixtures.test.ts`
use these files to validate real-export parsing paths.
