---
'@targus/cli': patch
---

A failed API request now ends its error message with the id the API gave it, as
`(request id: <id>)`, taken from the error body or, when the body has none, from the
`x-request-id` header. After retries the id is the last attempt's, and each retry warning names
its own. Quote it when reporting a failure: it finds the request's log line. Exit codes and the
rest of the wording are unchanged.
