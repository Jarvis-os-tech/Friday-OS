CXX      := g++
CXXFLAGS := -O3 -Wall -Wextra -std=c++17
SRCDIR   := src
BINDIR   := bin

SOURCES  := $(wildcard $(SRCDIR)/*.cpp)
TARGETS  := $(patsubst $(SRCDIR)/%.cpp,$(BINDIR)/%,$(SOURCES))

.PHONY: all clean

all: $(BINDIR) $(TARGETS)

$(BINDIR):
	mkdir -p $(BINDIR)

$(BINDIR)/%: $(SRCDIR)/%.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<

clean:
	rm -rf $(BINDIR)
