# SPDX-License-Identifier: Apache-2.0
# Noviscia C++ SDK — minimal build (no external deps).
# Consumers preferring CMake may use the CMakeLists.txt instead.

CXX      ?= g++
CXXFLAGS ?= -std=c++20 -O2 -Wall -Wextra -Wpedantic
INCLUDES  = -Iinclude
SRCS      = src/hash.cpp src/curve25519.cpp src/pubkey.cpp src/addresses.cpp
OBJS      = $(SRCS:.cpp=.o)
TEST_SRC  = test/noviscia_test.cpp

.PHONY: all test clean

all: test

test: $(OBJS) $(TEST_SRC)
	$(CXX) $(CXXFLAGS) $(INCLUDES) $(OBJS) $(TEST_SRC) -o noviscia_test
	./noviscia_test

%.o: %.cpp
	$(CXX) $(CXXFLAGS) $(INCLUDES) -c $< -o $@

clean:
	rm -f $(OBJS) noviscia_test