SHELL := /bin/zsh

# Local mock-update loop for the desktop app.
#
# electron-updater polls a feed URL baked into the app at build time. Building
# with --mock-updates points that feed at a local static server (generic
# provider, default http://localhost:3000) instead of GitHub Releases, so
# serving release-mock/ exercises check -> download -> install end to end with
# no GitHub round trip.
#
# The one hard requirement is signing: Squirrel.Mac refuses to install a bundle
# whose signature seals no resources ("code has no resources but signature
# indicates they must be present"), which rules out the default adhoc build
# entirely. Any real identity works — including a self-signed cert — as long as
# old and new builds share it, since the update's designated requirement is the
# cert leaf hash, not the app version or binary hash. `make update-cert`
# creates that cert once; builds pick it up via T3CODE_DESKTOP_IDENTITY (see
# scripts/build-desktop-artifact.ts).

APP_NAME := T3 Code (Alpha)
APP_PATH := /Applications/$(APP_NAME).app
ARCH     ?= arm64
PORT     ?= 3000
# Name of the keychain identity used to sign mock-update builds.
IDENTITY ?= T3 Code Local Signing
MOCK_DIR := release-mock
MANIFEST := $(MOCK_DIR)/latest-mac.yml

# SKIP_BUILD=1 reuses the previous apps/*/dist output (~60s faster); the app
# version is stamped at packaging time, so reusing dist is safe for update
# payloads. Set to 0 for a clean rebuild.
SKIP_BUILD ?= 0

.DEFAULT_GOAL := help

.PHONY: help update-cert update-next update-serve update-serve-stop update-status

##@ Local update loop

help: ## Show the available targets
	@printf "\n\033[1mt3code\033[0m — local update loop\n\n"
	@awk 'BEGIN {FS = ":.*##"} \
		/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5); next } \
		/^[a-zA-Z0-9_.%-]+:.*##/ { printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf "\n\033[1mKnobs\033[0m\n"
	@printf "  \033[36mSKIP_BUILD=1\033[0m           reuse compiled dist (~60s faster)\n"
	@printf "  \033[36mIDENTITY=name\033[0m          keychain identity to sign with\n"
	@printf "  \033[36mPORT=3000\033[0m              mock update server port (baked into builds)\n"
	@printf "  \033[36mARCH=arm64|x64\033[0m         build architecture\n"
	@printf "\n\033[1mFirst run\033[0m\n"
	@printf "  make update-cert            one-time self-signed cert in your keychain\n"
	@printf "  make update-build-0.0.41    build the version the app will run\n"
	@printf "  make update-install-0.0.41  plant it in /Applications (once, by hand)\n"
	@printf "  make update-serve           start the feed on :3000\n"
	@printf "\n\033[1mEvery update after that\033[0m\n"
	@printf "  make update-next            bump the served version and build it\n"
	@printf "  then click the rocket in the app\n\n"

update-cert: ## Create the self-signed code-signing cert (once)
	@if security find-identity -v -p codesigning | grep -qF "$(IDENTITY)"; then \
		printf "  ok    \"$(IDENTITY)\" already exists\n"; \
		exit 0; \
	fi
	@set -e; \
	TMP="$$(mktemp -d)"; \
	trap 'rm -rf "$$TMP"' EXIT; \
	echo "--> Generating self-signed cert \"$(IDENTITY)\""; \
	openssl req -x509 -newkey rsa:2048 -nodes \
	  -keyout "$$TMP/key.pem" -out "$$TMP/cert.pem" -days 3650 \
	  -subj "/CN=$(IDENTITY)" \
	  -addext "extendedKeyUsage=critical,codeSigning" \
	  -addext "keyUsage=critical,digitalSignature,keyCertSign" \
	  -addext "basicConstraints=critical,CA:true" >/dev/null 2>&1; \
	openssl pkcs12 -export -out "$$TMP/cert.p12" \
	  -inkey "$$TMP/key.pem" -in "$$TMP/cert.pem" -password pass:t3code \
	  -name "$(IDENTITY)" >/dev/null 2>&1; \
	security import "$$TMP/cert.p12" -k login.keychain -P t3code -A; \
	@# CA:true + trustRoot are both required: find-identity -p codesigning runs a
	@# policy eval that drops the cert unless it anchors code-signing trust, and
	@# electron-builder falls back to adhoc when the identity isn't listed.
	security add-trusted-cert -r trustRoot -p codeSign -k login.keychain "$$TMP/cert.pem"; \
	security find-identity -v -p codesigning | grep -F "$(IDENTITY)" && \
	echo "--> Installed + trusted for code signing"

update-build-%: ## Build version % into release-mock (signed, mock feed, zip)
	@if ! security find-identity -v -p codesigning | grep -qF "$(IDENTITY)"; then \
		echo "No identity \"$(IDENTITY)\" — run 'make update-cert' first."; \
		echo "An adhoc build can check and download, but Squirrel refuses the install."; \
		exit 1; \
	fi
	T3CODE_DESKTOP_IDENTITY="$(IDENTITY)" \
	  vp run dist:desktop:artifact \
	  --platform mac --target zip --arch $(ARCH) \
	  --mock-updates --mock-update-server-port $(PORT) \
	  $(if $(filter 1,$(SKIP_BUILD)),--skip-build,) \
	  --build-version $*
	@echo "--> $(MANIFEST) now advertises $*"

update-next: ## Bump the advertised patch version and build it
	@set -e; \
	CUR="$$(awk '/^version:/{print $$2; exit}' $(MANIFEST) 2>/dev/null)"; \
	if [ -z "$$CUR" ]; then \
		echo "No $(MANIFEST) — run 'make update-build-X.Y.Z' to seed it first."; \
		exit 1; \
	fi; \
	NEXT="$$(CUR="$$CUR" node -e 'const p=process.env.CUR.split(".").map(Number); p[2]+=1; console.log(p.join("."))')"; \
	echo "--> $$CUR -> $$NEXT"; \
	$(MAKE) --no-print-directory update-build-$$NEXT SKIP_BUILD=$(SKIP_BUILD)

update-install-%: ## Install version % from release-mock into /Applications
	@set -e; \
	ZIP="$(MOCK_DIR)/T3-Code-$*-$(ARCH).zip"; \
	if [ ! -f "$$ZIP" ]; then \
		echo "No $$ZIP — run 'make update-build-$*' first."; \
		exit 1; \
	fi; \
	@# The app holds its single-instance lock on the running process, so the new
	@# bundle must be swapped in while it is not running; osascript quits cleanly.
	if pgrep -f "$(APP_PATH)/Contents/MacOS" >/dev/null 2>&1; then \
		echo "Quitting the running app…"; \
		osascript -e 'quit app "$(APP_NAME)"' >/dev/null 2>&1 || true; sleep 2; \
	fi; \
	TMP="$$(mktemp -d)"; \
	trap 'rm -rf "$$TMP"' EXIT; \
	unzip -o -q "$$ZIP" -d "$$TMP"; \
	rm -rf "$(APP_PATH)"; \
	cp -R "$$TMP/$(APP_NAME).app" /Applications/; \
	INSTALLED="$$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' '$(APP_PATH)/Contents/Info.plist' 2>/dev/null)"; \
	if [ "$$INSTALLED" != "$*" ]; then \
		echo "Install verification failed: expected $*, found $$INSTALLED"; \
		exit 1; \
	fi; \
	echo "Installed $(APP_PATH) ($$INSTALLED)"

update-serve: ## Serve release-mock/ on :$(PORT) in the background
	@if lsof -ti :$(PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Something is already listening on :$(PORT)."; \
		echo "Restart with 'make update-serve-stop && make update-serve'."; \
	else \
		T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT=$(PORT) \
		nohup node scripts/mock-update-server.ts > /tmp/t3-mock-update-server.log 2>&1 & \
		sleep 1; \
		if curl -sf "http://localhost:$(PORT)/latest-mac.yml" >/dev/null; then \
			echo "Serving $(MOCK_DIR) on :$(PORT) (log: /tmp/t3-mock-update-server.log)"; \
		else \
			echo "Server failed to start — see /tmp/t3-mock-update-server.log"; exit 1; \
		fi; \
	fi

update-serve-stop: ## Stop the mock update server
	@PID="$$(lsof -ti :$(PORT) -sTCP:LISTEN 2>/dev/null | head -n 1)"; \
	if [ -z "$$PID" ]; then echo "Nothing listening on :$(PORT)"; exit 0; fi; \
	if ps -p "$$PID" -o command= | grep -q "mock-update-server"; then \
		kill "$$PID" && echo "Stopped mock update server (pid $$PID)"; \
	else \
		echo "Port $(PORT) is held by something else, leaving it alone:"; \
		ps -p "$$PID" -o pid=,command=; \
		exit 1; \
	fi

update-status: ## Show installed version, advertised version, cert + server state
	@printf "\033[1mInstalled\033[0m\n"
	@INSTALLED="$$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' '$(APP_PATH)/Contents/Info.plist' 2>/dev/null || echo 'not installed')"; \
	printf "  version     %s\n" "$$INSTALLED"; \
	FEED="$$(awk '/^url:/{print $$2; exit}' '$(APP_PATH)/Contents/Resources/app-update.yml' 2>/dev/null)"; \
	printf "  feed        %s\n" "$${FEED:-none baked in}"; \
	SIG="$$(codesign -dv '$(APP_PATH)' 2>&1 | sed -n 's/^Signature=\(.*\)/\1/p; s/^Signature size=.*/signed/p' | head -n1)"; \
	printf "  signature   %s\n" "$${SIG:-unknown}"
	@printf "\033[1mAdvertised\033[0m\n"
	@ADV="$$(awk '/^version:/{print $$2; exit}' $(MANIFEST) 2>/dev/null)"; \
	printf "  version     %s\n" "$${ADV:-no manifest}"
	@printf "\033[1mEnvironment\033[0m\n"
	@if security find-identity -v -p codesigning | grep -qF "$(IDENTITY)"; then \
		printf "  ok    cert \"$(IDENTITY)\" trusted for code signing\n"; \
	else \
		printf "  MISS  no cert — run: make update-cert\n"; \
	fi
	@if lsof -ti :$(PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		printf "  ok    update server listening on :$(PORT)\n"; \
	else \
		printf "  MISS  no server — run: make update-serve\n"; \
	fi
	@printf "\n"
