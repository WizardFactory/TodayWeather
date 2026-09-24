# Investigation
Confirmed app.js imports New Relic before config; New Relic itself imports config. Bootstrap belongs before that first import and must also work for direct app imports.
Installed dotenv 10.0.0 in an isolated temporary prefix. Its package declares Node >=10, matching the recorded service Node 10.15.3 (not a fresh host observation). Its config preserves existing process values, returns ENOENT for a missing file, and returns other read errors. Parser ignores non-assignment lines, strips balanced single/double quotes, and supports JSON arrays as strings. It does not support export prefixes or inline comments; document these rather than invent a parser.
No server node_modules exists. Existing offline dependencies are available at /tmp/issue-2560-offline/node_modules.
Network lookup failed under sandbox (EAI_AGAIN); authorized escalated npm install succeeded. Archify subprocess was blocked under sandbox (EPERM); escalated deliver passed 9/9 checks without warnings.
