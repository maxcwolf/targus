# Run targus in CircleCI

> [!NOTE]
> This recipe follows the [GitHub Actions workflow](ci-github-actions.md), which runs today on
> the targus proof of concept. The CircleCI version has not run end to end yet. Read the GitHub
> Actions guide for why each step is there.

It uses the two scripts from [Prepare your app](prepare-your-app.md#5-build-the-simulator-app),
`scripts/build-ios-sim.sh` and `scripts/bundle-js.sh`. Put `TARGUS_TOKEN` and `TARGUS_API_URL`
in a CircleCI context named `targus`.

```yaml
version: 2.1

jobs:
  visual_ios:
    macos:
      xcode: 26.2.0 # pin it: another Xcode renders a little differently
    resource_class: m4pro.medium
    environment:
      DEVICE_TYPE: iPhone 16
      APP: build/MyApp.app
    steps:
      - checkout # clones the full history, which targus run needs
      - run: corepack enable && yarn install --immutable
      - run:
          name: Fingerprint the native app
          command: |
            npx @expo/fingerprint fingerprint:generate --platform ios \
              | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).hash))' > .ios-fingerprint
            xcodebuild -version >> .ios-fingerprint
      - restore_cache:
          keys:
            - targus-ios-app-v1-{{ checksum ".ios-fingerprint" }}
      - run:
          name: Build the simulator app on a fingerprint miss
          command: '[ -d "$APP" ] || bash scripts/build-ios-sim.sh'
      - save_cache:
          key: targus-ios-app-v1-{{ checksum ".ios-fingerprint" }}
          paths:
            - build/MyApp.app
      - run:
          name: Re-bundle the JavaScript and swap it into the app
          command: bash scripts/bundle-js.sh
      - run:
          name: Create the simulator
          # Left shut down: targus run boots it and keeps system notices out of the screenshots.
          command: |
            udid=$(xcrun simctl create targus-ci "$DEVICE_TYPE")
            echo "export UDID=$udid" >> "$BASH_ENV"
      - run:
          name: Capture and publish
          command: |
            npx targus run --udid "$UDID" --device-name "$DEVICE_TYPE" --app "$APP" \
              --out visual/current --connect-timeout 120000
      - store_artifacts:
          path: visual/current

workflows:
  build:
    jobs:
      - visual_ios:
          context: targus
```

CircleCI checks out the pull request's head commit, so no `--sha` is needed. The CLI reads the
branch and PR number from `CIRCLE_BRANCH`, `CIRCLE_PULL_REQUEST` and `CIRCLE_PR_NUMBER`.

The bundling step must see the same environment as the native build, or the app's config
resolves differently and the bundle drifts from the binary.
