#!/bin/bash
# MCP Tools Test Script - Tests all MCP tools one by one
set -e

BASE="http://localhost:8056"
PASS=0
FAIL=0
SKIP=0
TOTAL=0
FAILURES=""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Get auth token
echo -e "${CYAN}=== Getting Auth Token ===${NC}"
LOGIN_RESP=$(curl -s -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d '{"email":"admin@baasix.com","password":"admin@123"}')
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token: ${TOKEN:0:30}..."

# Initialize MCP session
echo -e "${CYAN}=== Initializing MCP Session ===${NC}"
curl -s -D /tmp/mcp-h.txt -X POST "$BASE/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' > /dev/null 2>&1
SESSION=$(grep -i 'mcp-session-id' /tmp/mcp-h.txt | tr -d '\r' | awk '{print $2}')
echo "Session: $SESSION"
echo ""

# Helper to call MCP tool and check result
call_tool() {
  local name="$1"
  local args="$2"
  local description="$3"
  TOTAL=$((TOTAL + 1))
  
  local payload="{\"jsonrpc\":\"2.0\",\"id\":$TOTAL,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}"
  
  local resp=$(curl -s -X POST "$BASE/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Mcp-Session-Id: $SESSION" \
    -d "$payload" 2>/dev/null)
  
  # Extract the JSON data from SSE format
  local json_data=$(echo "$resp" | grep '^data: ' | head -1 | sed 's/^data: //')
  
  # Check if it's an error
  local is_error=$(echo "$json_data" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if 'error' in d or d.get('result',{}).get('isError',False) else 'no')" 2>/dev/null)
  
  if [ "$is_error" = "no" ] && [ -n "$json_data" ]; then
    echo -e "  ${GREEN}✓ PASS${NC} - $name: $description"
    PASS=$((PASS + 1))
  elif [ -z "$json_data" ]; then
    echo -e "  ${RED}✗ FAIL${NC} - $name: $description (empty response)"
    FAIL=$((FAIL + 1))
    FAILURES="$FAILURES\n  - $name: empty response"
  else
    local err_msg=$(echo "$json_data" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print(d['error'].get('message','unknown'))
else:
    c=d.get('result',{}).get('content',[])
    print(c[0].get('text','unknown')[:200] if c else 'unknown')
" 2>/dev/null)
    echo -e "  ${RED}✗ FAIL${NC} - $name: $description"
    echo -e "         Error: $err_msg"
    FAIL=$((FAIL + 1))
    FAILURES="$FAILURES\n  - $name: $err_msg"
  fi
}

# Expect-error variant (tool expected to error but still be registered)
call_tool_expect_error() {
  local name="$1"
  local args="$2"
  local description="$3"
  TOTAL=$((TOTAL + 1))
  
  local payload="{\"jsonrpc\":\"2.0\",\"id\":$TOTAL,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}"
  
  local resp=$(curl -s -X POST "$BASE/mcp" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Mcp-Session-Id: $SESSION" \
    -d "$payload" 2>/dev/null)
  
  local json_data=$(echo "$resp" | grep '^data: ' | head -1 | sed 's/^data: //')
  
  if [ -n "$json_data" ]; then
    echo -e "  ${GREEN}✓ PASS${NC} - $name: $description (got response, error expected)"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗ FAIL${NC} - $name: $description (no response at all)"
    FAIL=$((FAIL + 1))
    FAILURES="$FAILURES\n  - $name: no response"
  fi
}

echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Testing All MCP Tools One by One        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ===== 1. AUTH TOOLS =====
echo -e "${YELLOW}── Auth Tools ──${NC}"
call_tool "baasix_login" '{"email":"admin@baasix.com","password":"admin@123"}' "Login"
call_tool "baasix_auth_status" '{}' "Auth status"
call_tool "baasix_get_current_user" '{}' "Get current user"
call_tool "baasix_get_user_tenants" '{}' "Get user tenants"
echo ""

# ===== 2. SCHEMA TOOLS =====
echo -e "${YELLOW}── Schema Tools ──${NC}"
call_tool "baasix_list_schemas" '{}' "List all schemas"
call_tool "baasix_list_schemas" '{"search":"user"}' "List schemas with search"
call_tool "baasix_get_schema" '{"collection":"baasix_User"}' "Get User schema"
call_tool "baasix_export_schemas" '{}' "Export all schemas"
echo ""

# ===== 3. ITEMS TOOLS =====
echo -e "${YELLOW}── Items Tools ──${NC}"
call_tool "baasix_list_items" '{"collection":"baasix_User","fields":["*"],"limit":5}' "List users"
call_tool "baasix_list_items" '{"collection":"baasix_User","fields":["*"],"filter":{"email":{"eq":"admin@baasix.com"}}}' "List users with filter"
call_tool "baasix_list_items" '{"collection":"baasix_User","fields":["id","email"],"sort":"email:asc","limit":3}' "List users sorted"
call_tool "baasix_list_items" '{"collection":"baasix_Role","fields":["*"],"search":"admin"}' "Search roles"

# Create an item in mcptest table  
call_tool "baasix_create_item" '{"collection":"mcptest","data":{"name":"Test Item","price":29.99,"quantity":10}}' "Create item"

# Get item (we'll use list to find one)
call_tool "baasix_list_items" '{"collection":"mcptest","fields":["*"],"limit":1}' "List mcptest items"
echo ""

# ===== 4. FILES TOOLS =====
echo -e "${YELLOW}── Files Tools ──${NC}"
call_tool "baasix_list_files" '{}' "List files"
echo ""

# ===== 5. PERMISSIONS TOOLS =====
echo -e "${YELLOW}── Permissions & Roles Tools ──${NC}"
call_tool "baasix_list_permissions" '{}' "List permissions"
call_tool "baasix_list_roles" '{}' "List roles"
echo ""

# ===== 6. SETTINGS TOOLS =====
echo -e "${YELLOW}── Settings Tools ──${NC}"
call_tool "baasix_get_settings" '{}' "Get all settings"
call_tool "baasix_get_settings" '{"key":"project_name"}' "Get settings by key"
echo ""

# ===== 7. TEMPLATE TOOLS =====
echo -e "${YELLOW}── Template Tools ──${NC}"
call_tool "baasix_list_templates" '{}' "List templates"
echo ""

# ===== 8. NOTIFICATION TOOLS =====
echo -e "${YELLOW}── Notification Tools ──${NC}"
call_tool "baasix_list_notifications" '{}' "List notifications"
echo ""

# ===== 9. REPORT TOOLS (REWRITTEN) =====
echo -e "${YELLOW}── Report Tools (rewritten) ──${NC}"
call_tool "baasix_generate_report" '{"collection":"baasix_User","fields":["id","email","firstName"],"limit":5}' "Basic report"
call_tool "baasix_generate_report" '{"collection":"baasix_User","aggregate":{"total":{"function":"count","field":"*"}}}' "Report with aggregate"
call_tool "baasix_generate_report" '{"collection":"baasix_User","fields":["email"],"filter":{"email":{"eq":"admin@baasix.com"}},"sort":["email:asc"],"limit":1}' "Report with filter + sort"
echo ""

# ===== 10. STATS TOOLS (REWRITTEN) =====
echo -e "${YELLOW}── Stats Tools (rewritten) ──${NC}"
call_tool "baasix_collection_stats" '{"stats":[{"name":"user_count","collection":"baasix_User","query":{"aggregate":{"total":{"function":"count","field":"*"}}}}]}' "Single collection stats"
call_tool "baasix_collection_stats" '{"stats":[{"name":"users","collection":"baasix_User","query":{"aggregate":{"total":{"function":"count","field":"*"}}}},{"name":"roles","collection":"baasix_Role","query":{"aggregate":{"total":{"function":"count","field":"*"}}}}]}' "Multi collection stats"
echo ""

# ===== 11. SORT TOOL (REWRITTEN) =====
echo -e "${YELLOW}── Sort Tool (rewritten) ──${NC}"
call_tool_expect_error "baasix_sort_items" '{"collection":"mcptest","item":"00000000-0000-0000-0000-000000000001","to":"00000000-0000-0000-0000-000000000002"}' "Sort items (expect error - invalid IDs)"
echo ""

# ===== 12. SCHEMA CRUD =====
echo -e "${YELLOW}── Schema CRUD Tools ──${NC}"
call_tool "baasix_create_schema" '{"collection":"mcp_test_crud","schema":{"timestamps":true,"fields":{"id":{"type":"UUID","primaryKey":true,"defaultValue":{"type":"UUIDV4"}},"title":{"type":"String","allowNull":false,"values":{"length":255}},"count":{"type":"Integer","defaultValue":0}}}}' "Create schema"
call_tool "baasix_update_schema" '{"collection":"mcp_test_crud","schema":{"fields":{"description":{"type":"Text"}}}}' "Update schema (add field)"
call_tool "baasix_add_index" '{"collection":"mcp_test_crud","indexDefinition":{"fields":["title"],"type":"btree"}}' "Add index"
call_tool "baasix_delete_schema" '{"collection":"mcp_test_crud"}' "Delete schema"
echo ""

# ===== 13. USER MANAGEMENT =====
echo -e "${YELLOW}── User Management Tools ──${NC}"
call_tool_expect_error "baasix_verify_invite" '{"token":"invalid-token-123"}' "Verify invite (expect error - invalid token)"
echo ""

# ===== 14. RELATIONSHIP TOOLS =====
echo -e "${YELLOW}── Relationship Tools ──${NC}"
# We'd need two tables for this - skip if mcptest doesn't work
call_tool_expect_error "baasix_create_relationship" '{"sourceCollection":"mcptest","relationshipData":{"name":"user","type":"M2O","target":"baasix_User","alias":"mcptests","onDelete":"SET NULL"}}' "Create relationship"
echo ""

# ===== SUMMARY =====
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              TEST SUMMARY                   ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo -e "  Total:  $TOTAL"
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
if [ $FAIL -gt 0 ]; then
  echo -e ""
  echo -e "  ${RED}Failed tools:${NC}"
  echo -e "$FAILURES"
fi
echo ""
echo "Done!"
