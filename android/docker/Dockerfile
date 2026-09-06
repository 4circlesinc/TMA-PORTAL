# Reproducible Gradle builds for android/. The emulator does not run here (no KVM on macOS); use Android Studio for that.
FROM eclipse-temurin:17-jdk-jammy
ENV ANDROID_SDK_ROOT=/opt/android-sdk ANDROID_HOME=/opt/android-sdk \
    PATH=$PATH:/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/platform-tools
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip git && rm -rf /var/lib/apt/lists/* \
 && mkdir -p $ANDROID_SDK_ROOT/cmdline-tools \
 && curl -sSL -o /tmp/ct.zip https://dl.google.com/android/repository/commandlinetools-linux-15641748_latest.zip \
 && unzip -q /tmp/ct.zip -d $ANDROID_SDK_ROOT/cmdline-tools && mv $ANDROID_SDK_ROOT/cmdline-tools/cmdline-tools $ANDROID_SDK_ROOT/cmdline-tools/latest \
 && rm /tmp/ct.zip \
 && yes | sdkmanager --licenses >/dev/null \
 && sdkmanager "platform-tools" "platforms;android-37.0" "build-tools;37.0.0"
RUN useradd -m -u 1000 builder && chown -R builder /opt/android-sdk
USER builder
WORKDIR /workspace/android
CMD ["./gradlew", "assembleDebug", "--no-daemon"]
