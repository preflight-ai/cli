# Prefl AI - Your Dream Code Review Tool ✨

**Professional AI-powered code review that catches bugs before they reach production**

Website: [prefl.run](https://prefl.run)

---

## 🚀 Features

- **🔍 Comprehensive Analysis** - Detects runtime errors, security vulnerabilities, memory leaks, performance issues
- **🎯 Smart Context Tracking** - Analyzes related code and imports to maintain full context
- **🚨 Critical Issue Blocking** - Prevents commits with critical problems
- **🌍 Multi-Language Support** - Works with any programming language
- **⚡ Lightning Fast** - Analyzes only staged changes, not entire codebase
- **🎨 Beautiful Output** - Clear, emoji-rich reports with actionable fixes
- **💾 Export Reports** - Save detailed analysis to files
- **🪝 Git Integration** - Auto-runs on pre-commit hooks

---

## 📦 Installation

```bash
npm i -g @preflight-ai/cli@latest
```

---

## 🛠️ Setup

### 1. Initialize in your project

```bash
cd your-project
prefl init
```

This will:

- ✅ Create `prefl.json` config file
- ✅ Create `.env` and ask for your GROQ API key
- ✅ Add `.env` to `.gitignore`
- ✅ Install pre-commit hook automatically

### 2. Get your Groq API Key

1. Visit [console.groq.com](https://console.groq.com)
2. Create a free account
3. Generate an API key
4. Paste it when prompted during `prefl init`

---

## 🎯 Usage

### Automatic Review (Recommended)

Once initialized, Prefl automatically reviews your code before every commit:

```bash
git add .
git commit -m "feat: add new feature"
# ✨ Prefl analyzes your changes automatically!
```

### Manual Analysis

```bash
# Analyze staged changes
prefl analyze

# Analyze entire repository
prefl analyze --all

# Save report to file
prefl analyze --output my-report.txt

# JSON output for CI/CD
prefl analyze --format json
```

### Commands

```bash
prefl init                    # Setup Prefl in your project
prefl analyze                 # Analyze staged changes
prefl analyze --all           # Analyze entire repo
prefl analyze --output FILE   # Save results to file
prefl fix                     # Generate AI-suggested patches
prefl fix --apply             # Auto-apply generated fixes
prefl --version               # Show version
prefl --help                  # Show help
```

---

## 📊 What Gets Analyzed?

### 🚨 **CRITICAL ISSUES** (Blocks Commits)

- **Runtime Errors**: Null/undefined access, type mismatches, unhandled promises
- **Security Vulnerabilities**: SQL injection, XSS, CSRF, exposed secrets, insecure auth
- **Memory Leaks**: Event listeners without cleanup, circular references
- **Data Loss**: Missing validation, race conditions, improper async handling

### ⚠️ **WARNINGS** (Alerts)

- **Performance**: N+1 queries, unnecessary re-renders, blocking operations
- **Code Smells**: Tight coupling, magic numbers, duplicated logic
- **Accessibility**: Missing ARIA labels, keyboard navigation issues
- **Edge Cases**: Empty arrays, null inputs, boundary conditions

### ℹ️ **SUGGESTIONS** (Nice to Have)

- **Best Practices**: Inconsistent naming, missing types, outdated patterns
- **Optimization**: Memoization opportunities, lazy loading, code splitting
- **Maintainability**: Complex logic without comments, long functions

---

## 🎨 Example Output

```
📊 Code Review Results

🚨 Critical: 2 | ⚠️  Warnings: 3 | ℹ️  Info: 1
────────────────────────────────────────────────────────

🚨 CRITICAL ISSUES (Must Fix)

1. 🚨 Potential runtime error: chained property access after JSON.parse without validation
   📁 File: src/api.ts (line 45)
   📝 Code: const userId = JSON.parse(response).user.id;
   ✅ Fix: Assign JSON.parse result to a variable, validate it, then access properties safely:
           const data = JSON.parse(response);
           if (data && typeof data === 'object') { /* use data */ }

2. 🔒 Security: Hardcoded secret detected
   📁 File: src/config.ts (line 12)
   📝 Code: const API_KEY = "sk-123456789";
   ✅ Fix: Move secrets to environment variables (.env) and add .env to .gitignore

────────────────────────────────────────────────────────

⚠️  WARNINGS (Recommended Fixes)

1. ⚠️ Potential memory leak: addEventListener without cleanup
   📁 File: src/components/Modal.tsx (line 28)
   📝 Code: window.addEventListener('keydown', handleEscape);
   💡 Fix: Store the listener reference and remove it in cleanup

────────────────────────────────────────────────────────
🛑 Commit blocked due to critical issues. Please fix them first.
```

---

## ⚙️ Configuration

Edit `prefl.json` in your project root:

```json
{
  "ignore": {
    "globs": [
      "node_modules/**",
      "dist/**",
      ".git/**",
      "*.test.js",
      "coverage/**"
    ]
  },
  "review": {
    "blockSeverities": ["critical"],
    "context": {
      "baseLimit": 10,
      "importExpansionLimit": 20
    }
  }
}
```

### Configuration Options

- **ignore.globs**: Files/folders to skip (supports glob patterns)
- **review.blockSeverities**: Which severity levels block commits (`["critical"]`, `["critical", "warning"]`, or `[]`)
- **review.context.baseLimit**: How many files to include as context (default: 10)
- **review.context.importExpansionLimit**: Max files to add via import tracking (default: 20)

---

## 🔧 Advanced Features

### Generate and Apply Fixes

```bash
# Generate a patch file
prefl fix

# Validate the patch
prefl fix --dry-run

# Auto-apply the patch
prefl fix --apply
```

### CI/CD Integration

```yaml
# .github/workflows/code-review.yml
name: Prefl Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm i -g @preflight-ai/cli
      - run: prefl analyze --format json
        env:
          GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
```

---

## 🌟 Why Prefl?

| Feature                 | Prefl | ESLint       | SonarQube    |
| ----------------------- | ----- | ------------ | ------------ |
| AI-Powered Analysis     | ✅    | ❌           | ❌           |
| Runtime Error Detection | ✅    | ⚠️ Limited   | ⚠️ Limited   |
| Security Scanning       | ✅    | ⚠️ Plugins   | ✅           |
| Memory Leak Detection   | ✅    | ❌           | ⚠️ Limited   |
| Multi-Language          | ✅    | ❌           | ✅           |
| Context-Aware           | ✅    | ❌           | ⚠️ Limited   |
| Actionable Fixes        | ✅    | ⚠️ Sometimes | ⚠️ Sometimes |
| Beautiful Output        | ✅    | ❌           | ⚠️ Web Only  |
| Auto-Fix Suggestions    | ✅    | ⚠️ Limited   | ❌           |

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md).

---

## 📄 License

Apache 2.0 - See [LICENSE](LICENSE) for details

---

## 💬 Support

- 🌐 Website: [prefl.run](https://prefl.run)
- 📧 Email: support@prefl.run
- 🐛 Issues: [GitHub Issues](https://github.com/gvinianidzegivi/prefl-cli/issues)

---

**Made with ❤️ by developers, for developers**
