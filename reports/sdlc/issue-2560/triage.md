# Source findings
Current master equals initial checkout; git ls-remote origin refs/heads/master confirmed 01eb787b.
collectTownForecast.organizeLandData unconditionally reads day 3; organizeTempData inserts -100. Envelope validation already exists in getData and logs sanitized diagnostics.
Both land schemas omit rnSt. Projection/type selection relies on global field arrays and day 10. Manager saveMidLand hands the first parsed record to the selected DB controller; preserve this flow.
_mergeLandWithTemp uses independent calendar bases but generates all eight horizons before filtering. getMid aborts on missing text/land/temp; formatter invents clear sky for unknown strings. getPastMid supplies seven days of current-history comparisons.
RSS writes publication before validating data, mixes timestamp representations and appends old dates. No verified replacement feed provided; retire collection and cache application.
