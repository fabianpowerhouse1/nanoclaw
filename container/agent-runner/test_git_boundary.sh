#!/bin/bash
INTERFACE_SH="/home/ubuntu/powerhouse/skills/github/interface.sh"

# Mock GH_TOKEN
export GH_TOKEN="test-token"

# 1. Test in non-git directory
mkdir -p test_dir_no_git
cd test_dir_no_git
echo "Testing non-git directory..."
bash "$INTERFACE_SH" commit main "test" > output.txt 2>&1
EXIT_CODE=$?
cat output.txt
if [ $EXIT_CODE -ne 0 ] && grep -q "\[ERROR\] No git repository found in current workspace" output.txt; then
    echo "PASSED: Non-git boundary enforced."
else
    echo "FAILED: Non-git boundary not enforced (Exit Code: $EXIT_CODE)."
    exit 1
fi
cd ..

# 2. Test in mock git directory
mkdir -p test_dir_with_git
cd test_dir_with_git
git init > /dev/null 2>&1
echo "Testing git directory..."
bash "$INTERFACE_SH" commit main "test" > output.txt 2>&1
EXIT_CODE=$?
cat output.txt
if [ $EXIT_CODE -eq 0 ] && grep -q "No changes to commit" output.txt; then
    echo "PASSED: Git operations allowed in repo root."
else
    echo "FAILED: Git operations blocked in repo root (Exit Code: $EXIT_CODE)."
    exit 1
fi
cd ..

rm -rf test_dir_no_git test_dir_with_git
echo "All Git Boundary Tests Passed."
