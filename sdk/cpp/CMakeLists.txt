# SPDX-License-Identifier: Apache-2.0
# Noviscia C++ SDK — CMake build (headers + static lib + tests).
#
#   cmake -B build && cmake --build build && ctest --test-dir build
#
# The core is a static library (`noviscia_cpp_sdk`) over pure C++17 headers;
# expressing the whole SDK so the rest of the build can link cheaply.

cmake_minimum_required(VERSION 3.14)
project(noviscia_cpp_sdk LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(noviscia_cpp_sdk STATIC
  src/hash.cpp
  src/curve25519.cpp
  src/pubkey.cpp
  src/addresses.cpp
)
target_include_directories(noviscia_cpp_sdk PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_compile_options(noviscia_cpp_sdk PRIVATE -Wall -Wextra -Wpedantic)

# The instruction builders and Merkle helpers are header-only (inline) — they
# do not add .cpp files but are included by consumers through the umbrella.

enable_testing()
add_executable(noviscia_cpp_sdk_tests test/noviscia_test.cpp)
target_link_libraries(noviscia_cpp_sdk_tests PRIVATE noviscia_cpp_sdk)
add_test(NAME noviscia_cpp_sdk_tests COMMAND noviscia_cpp_sdk_tests)