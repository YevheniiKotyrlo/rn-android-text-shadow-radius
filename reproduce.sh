#!/usr/bin/env bash
# Exit 1 while textShadowRadius blurs a Text's shadow by the same number of pixels at the attached Android device's own
# density as at 160 dpi, or textShadowRadius: 0 with an offset draws no shadow; 0 once neither holds; 2 when another
# step fails. Needs adb with one Android device of at least 320 dpi attached (ANDROID_SERIAL picks one of several),
# node, yarn and a JDK. It sets the device's density to 160 dpi for its second screenshot and puts it back on exit.
set -u

package=com.reproducerapp
blurred_label="blurred shadow"
zero_label="sharp shadow, radius 0"
one_label="sharp shadow, radius 1"
base_density=160
# What `wm density` printed as the override before the run, or nothing when the device ran at its own density.
density_to_restore=""
density_changed=0
# The run's scratch folder, which the exit trap removes.
work=""

fail_step() {
    echo "step failed: $1"
    exit 2
}

# The path as the platform's own programs take it: Git Bash's /c/... becomes C:/... for node on Windows.
native_path() {
    if command -v cygpath > /dev/null; then
        cygpath -m "$1"
    else
        printf '%s\n' "$1"
    fi
}

# Sets the named variable to a device property, without the carriage return adb's shell ends it with.
read_device_property() {
    local value
    value="$(adb shell getprop "$2")" || fail_step "adb shell getprop $2: ${value}"
    printf -v "$1" '%s' "${value//$'\r'/}"
}

restore_density() {
    if [[ "${density_changed}" -eq 1 ]]; then
        if [[ -n "${density_to_restore}" ]]; then
            adb shell wm density "${density_to_restore}" > /dev/null 2>&1
        else
            adb shell wm density reset > /dev/null 2>&1
        fi
        density_changed=0
    fi
}

dump_window() {
    adb shell uiautomator dump /sdcard/text-shadow-reproducer.xml > /dev/null 2>&1
    adb exec-out cat /sdcard/text-shadow-reproducer.xml > "$1" 2> /dev/null
    adb shell rm -f /sdcard/text-shadow-reproducer.xml
}

wait_for_label() {
    local hierarchy=$1 label=$2 attempt
    for ((attempt = 1; attempt <= 30; attempt += 1)); do
        dump_window "${hierarchy}"
        if grep -qF "content-desc=\"${label}\"" "${hierarchy}"; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# Prints "left,top,right,bottom" of the node whose content-desc is the label, from a `uiautomator dump`.
bounds_of() {
    local hierarchy=$1 label=$2 bounds
    bounds="$(sed -nE "s/.*content-desc=\"${label}\"[^>]*bounds=\"\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]\".*/\1,\2,\3,\4/p" \
        "${hierarchy}")"
    [[ -n "${bounds}" ]] || return 1
    echo "${bounds}"
}

screenshot() {
    adb exec-out screencap -p > "$1" 2> /dev/null && [[ -s "$1" ]]
}

# Starts the app afresh and sets blurred_bounds, zero_bounds and one_bounds from its window.
open_app() {
    local hierarchy=$1
    adb shell am force-stop "${package}"
    adb shell am start -W -n "${package}/.MainActivity" > /dev/null || fail_step "starting ${package}"
    wait_for_label "${hierarchy}" "${blurred_label}" || fail_step "the app showed no \"${blurred_label}\" text"
    sleep 2
    dump_window "${hierarchy}"
    blurred_bounds="$(bounds_of "${hierarchy}" "${blurred_label}")" || fail_step "no bounds for \"${blurred_label}\""
    zero_bounds="$(bounds_of "${hierarchy}" "${zero_label}")" || fail_step "no bounds for \"${zero_label}\""
    one_bounds="$(bounds_of "${hierarchy}" "${one_label}")" || fail_step "no bounds for \"${one_label}\""
}

main() {
    local here app shots
    here="$(cd "$(dirname "$0")" && pwd)"
    app="${here}/ReproducerApp"
    shots="${here}/screenshots"
    work="$(mktemp -d)"
    trap 'restore_density; if [[ -n "${work}" ]]; then rm -rf "${work}"; fi' EXIT
    mkdir -p "${shots}"

    local system node_version java_version
    system="$(uname -sm)"
    node_version="$(node --version 2>&1)" || fail_step "node --version: ${node_version}"
    java_version="$(java -version 2>&1)" || fail_step "java -version: ${java_version}"
    echo "${system}, node ${node_version}, ${java_version%%$'\n'*}"

    local device_state
    device_state="$(adb get-state 2>&1)"
    [[ "${device_state}" == "device" ]] || fail_step "adb get-state: ${device_state}"
    local model release sdk abi sizes densities screen physical_density override_density own_density
    read_device_property model ro.product.model
    read_device_property release ro.build.version.release
    read_device_property sdk ro.build.version.sdk
    read_device_property abi ro.product.cpu.abi
    sizes="$(adb shell wm size)" || fail_step "adb shell wm size: ${sizes}"
    sizes="${sizes//$'\r'/}"
    screen="$(sed -nE 's/^Override size: ([0-9]+x[0-9]+)$/\1/p' <<< "${sizes}")"
    [[ -n "${screen}" ]] || screen="$(sed -nE 's/^Physical size: ([0-9]+x[0-9]+)$/\1/p' <<< "${sizes}")"
    densities="$(adb shell wm density)" || fail_step "adb shell wm density: ${densities}"
    densities="${densities//$'\r'/}"
    physical_density="$(sed -nE 's/^Physical density: ([0-9]+)$/\1/p' <<< "${densities}")"
    override_density="$(sed -nE 's/^Override density: ([0-9]+)$/\1/p' <<< "${densities}")"
    own_density="${override_density:-${physical_density}}"
    [[ -n "${screen}" && -n "${own_density}" ]] || fail_step "wm size and wm density: ${sizes} ${densities}"
    echo "device: ${model}, Android ${release} (API ${sdk}), ${abi}, ${screen} at ${own_density} dpi"
    [[ "${own_density}" -ge $((2 * base_density)) ]] ||
        fail_step "the device runs at ${own_density} dpi; telling pixels from dp apart needs at least $((2 * base_density))"

    local install_output react_native_version
    install_output="$(cd "${app}" && yarn install --frozen-lockfile --non-interactive 2>&1)" ||
        { printf '%s\n' "${install_output}" | tail -n 20; fail_step "yarn install"; }
    react_native_version="$(cd "${app}" && node -p 'require("react-native/package.json").version' 2>&1)" ||
        fail_step "reading react-native's version: ${react_native_version}"
    echo "react-native ${react_native_version}"

    echo "== ./gradlew :app:assembleRelease -PreactNativeArchitectures=${abi}"
    local build_output
    build_output="$(cd "${app}/android" && ./gradlew --no-daemon --console=plain :app:assembleRelease \
        "-PreactNativeArchitectures=${abi}" 2>&1)" ||
        { printf '%s\n' "${build_output}" | tail -n 40; fail_step "the release build"; }

    local apk install_result
    apk="$(native_path "${app}/android/app/build/outputs/apk/release/app-release.apk")"
    install_result="$(adb install -r "${apk}" 2>&1)" || fail_step "adb install: ${install_result}"

    local hierarchy="${work}/hierarchy.xml" blurred_bounds zero_bounds one_bounds
    local own_shot="${shots}/1-at-${own_density}-dpi.png" base_shot="${shots}/2-at-${base_density}-dpi.png"
    local own_blurred own_zero own_one

    open_app "${hierarchy}"
    own_blurred="${blurred_bounds}"
    own_zero="${zero_bounds}"
    own_one="${one_bounds}"
    screenshot "${own_shot}" || fail_step "adb exec-out screencap -p"

    density_to_restore="${override_density}"
    density_changed=1
    adb shell wm density "${base_density}" > /dev/null || fail_step "adb shell wm density ${base_density}"
    sleep 2
    open_app "${hierarchy}"
    screenshot "${base_shot}" || fail_step "adb exec-out screencap -p"
    restore_density
    echo "screenshots: screenshots/${own_shot##*/}, screenshots/${base_shot##*/}"

    local measure_script own_file base_file
    measure_script="$(native_path "${here}/measure-shadows.mjs")"
    own_file="$(native_path "${own_shot}")"
    base_file="$(native_path "${base_shot}")"
    node "${measure_script}" \
        "${own_file}" "${own_density}" "${own_blurred}" "${own_zero}" "${own_one}" \
        "${base_file}" "${base_density}" "${blurred_bounds}" "${zero_bounds}" "${one_bounds}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    main "$@"
fi
