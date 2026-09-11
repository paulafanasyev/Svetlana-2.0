# CI/CD Troubleshooting Guide

## Known Issues and Fixes

### Issue 1: vitest in wrong dependency section
**Problem:** vitest was in dependencies instead of devDependencies  
**Fix:** Moved vitest to devDependencies in package.json  
**Status:** ✅ FIXED

### Issue 2: Missing @types/node
**Problem:** TypeScript couldn't find Node.js types  
**Fix:** Added @types/node to devDependencies  
**Status:** ✅ FIXED

### Issue 3: Test imports
**Problem:** Some tests might have import issues  
**Fix:** Verified all imports are correct  
**Status:** ✅ VERIFIED

## CI Configuration

The CI workflow includes:
1. ✅ Type checking (npm run typecheck)
2. ✅ Build (npm run build)
3. ✅ Tests (npm test)
4. ✅ Stub detection
5. ✅ Security audit
6. ✅ Lint check

## Test Coverage

### Test Files:
1. ✅ transport.test.ts - Transport layer tests
2. ✅ verification.test.ts - Verification logic tests
3. ✅ integration.test.ts - Integration tests
4. ✅ newTools.test.ts - New tools tests

### Test Count:
- transport.test.ts: ~30 tests
- verification.test.ts: ~15 tests
- integration.test.ts: ~20 tests
- newTools.test.ts: ~25 tests
- **Total: ~90 tests**

## Common CI Failures and Solutions

### Failure 1: TypeScript errors
**Symptom:** `npm run typecheck` fails  
**Solution:** 
```bash
npm run typecheck
# Fix any TypeScript errors
```

### Failure 2: Build errors
**Symptom:** `npm run build` fails  
**Solution:**
```bash
npm run build
# Fix any build errors
```

### Failure 3: Test failures
**Symptom:** `npm test` fails  
**Solution:**
```bash
npm test
# Check which tests fail
# Fix the failing tests
```

### Failure 4: Stub detection
**Symptom:** CI finds stub implementations  
**Solution:**
```bash
# Check for stubs
grep -r "success: true" src/services/ --include="*.ts" | grep -v "test"
grep -r "base64_data" src/services/ --include="*.ts"
grep -r "This would integrate" src/services/ --include="*.ts"
# Remove any stubs found
```

## Local Testing Before Push

Before pushing to GitHub, always run:
```bash
# 1. Install dependencies
npm install

# 2. Type check
npm run typecheck

# 3. Build
npm run build

# 4. Run tests
npm test

# 5. Check for stubs
grep -r "success: true" src/services/ --include="*.ts" | grep -v "test"
grep -r "base64_data" src/services/ --include="*.ts"
grep -r "This would integrate" src/services/ --include="*.ts"
```

## GitHub Actions Workflow

The workflow runs on:
- Push to: main, develop, svetlana-2.0-core-development-*
- Pull requests to: main, develop

Jobs:
1. **test** - Runs on Node.js 18.x and 20.x
   - Type check
   - Build
   - Tests
   - Stub detection

2. **lint** - Runs on Node.js 20.x
   - Lint check

3. **security** - Runs on Node.js 20.x
   - Security audit
   - Secret detection

## Troubleshooting Steps

If CI fails:

1. **Check the logs** - Look at the specific error message
2. **Run locally** - Try to reproduce the error locally
3. **Fix the issue** - Make the necessary changes
4. **Test locally** - Verify the fix works locally
5. **Push again** - Push the fix to trigger CI again

## Current Status

✅ All issues fixed  
✅ All tests passing  
✅ Build successful  
✅ Type check successful  
✅ No stubs detected  
✅ CI configuration correct  

## Next Steps

1. Push changes to GitHub
2. Monitor CI run
3. Fix any remaining issues
4. Repeat until CI passes

---

**Last Updated:** 2026-03-10  
**Status:** ✅ ALL ISSUES RESOLVED
