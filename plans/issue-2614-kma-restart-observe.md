# Plan for station observations after a restart

Task declaration: `server2/config/tasks/KMA-RESTART-OBSERVE.json`. Follows `plans/issue-2614-kma-image-production.md` and the EC2 restart comparison of #2866.

1. Read named members of one catalog (`CatalogStore::lookup_members`), and share the listing of a catalog's acquisitions (`Reader::listed_acquisitions`) between the image forecast and the observations.
2. List the minute catalog once at a restart and restore only the newest acquisition of each minute within reach.
3. Store the parsed station pages of a day as one product with a lossless value codec, and keep it out of the disk cache.
4. Write the changed day products after a fold that recomputed the hourly part, never awaited by a request.
5. Read the products at a restart, compare them with the day catalogs, restore only what they lack, and fall back to the raw pages when a product cannot be used. Finish today and yesterday before the answer and the rest after it, with S16 completeness kept.
6. Update the architecture and operations documents.
7. Open a draft PR and take it through CI and cross-provider review. AK decides on the merge.

## Scenarios

| User | Goal | Prerequisites | Actions | Expected | Failure path | Criteria |
| --- | --- | --- | --- | --- | --- | --- |
| App user | See current and past observations right after a deployment | Products of the window stored by the previous process | Request weather from the new process | Past hours and minute rows on the first answer, within 3 s | No product for a day: that day's raw pages follow after the answer | RESTART, MINUTE |
| Operator | Restart without re-parsing every page | Products stored, pages unchanged | Start a new process | No raw page read for the product days; no product stored | A product unreadable or of an older revision: that day's raw pages are read and its product stored again | RESTART, FALLBACK |
| Operator | Two hosts serve at once | Both fold the same pages | Both write their products; a third starts | The third reads the newest product of each day and answers as both | A page only one host has: the catalog comparison restores it | RESTART |
| Summary recorder | Record only complete days | One day had a group S06 excluded | Restart from the products | The day stays partial; no summary recorded from it | The rest of the read still running: answers unsettled until it ends | S16 |
| Operator | Keep S3 writes bounded | A long-running process | Requests every few minutes | A day's product only when its pages changed, at most once per ten minutes | A failed write is tried again ten minutes later | PRODUCT |
