// Starter files for new solutions. `{{year}}` and `{{day}}` are substituted.
// Each one reads the input path from argv (falling back to stdin) and prints
// "Part 1: ..." / "Part 2: ..." lines, which the extension picks up for submitting.
export const TEMPLATES: Record<string, string> = {
  python: `# Advent of Code {{year}} Day {{day}}
import sys


def part1(data: str):
    return None


def part2(data: str):
    return None


if __name__ == "__main__":
    data = open(sys.argv[1]).read() if len(sys.argv) > 1 else sys.stdin.read()
    print(f"Part 1: {part1(data)}")
    print(f"Part 2: {part2(data)}")
`,

  javascript: `// Advent of Code {{year}} Day {{day}}
const fs = require('fs');

function part1(data) {
  return null;
}

function part2(data) {
  return null;
}

const data = fs.readFileSync(process.argv[2] ?? 0, 'utf8');
console.log(\`Part 1: \${part1(data)}\`);
console.log(\`Part 2: \${part2(data)}\`);
`,

  typescript: `// Advent of Code {{year}} Day {{day}}
import { readFileSync } from 'node:fs';

function part1(data: string): unknown {
  return null;
}

function part2(data: string): unknown {
  return null;
}

const data = readFileSync(process.argv[2] ?? 0, 'utf8');
console.log(\`Part 1: \${part1(data)}\`);
console.log(\`Part 2: \${part2(data)}\`);
`,

  cpp: `// Advent of Code {{year}} Day {{day}}
#include <bits/stdc++.h>
using namespace std;

long long part1(const vector<string>& lines) {
    return 0;
}

long long part2(const vector<string>& lines) {
    return 0;
}

int main(int argc, char** argv) {
    ifstream file;
    if (argc > 1) file.open(argv[1]);
    istream& in = argc > 1 ? static_cast<istream&>(file) : cin;
    vector<string> lines;
    for (string line; getline(in, line);) lines.push_back(line);

    cout << "Part 1: " << part1(lines) << "\\n";
    cout << "Part 2: " << part2(lines) << "\\n";
}
`,

  rust: `// Advent of Code {{year}} Day {{day}}
use std::{env, fs, io::{self, Read}};

fn part1(_input: &str) -> i64 {
    0
}

fn part2(_input: &str) -> i64 {
    0
}

fn main() {
    let input = match env::args().nth(1) {
        Some(path) => fs::read_to_string(path).expect("failed to read input"),
        None => {
            let mut s = String::new();
            io::stdin().read_to_string(&mut s).expect("failed to read stdin");
            s
        }
    };
    println!("Part 1: {}", part1(&input));
    println!("Part 2: {}", part2(&input));
}
`,

  go: `// Advent of Code {{year}} Day {{day}}
package main

import (
	"fmt"
	"io"
	"os"
)

func part1(input string) int {
	return 0
}

func part2(input string) int {
	return 0
}

func main() {
	var data []byte
	var err error
	if len(os.Args) > 1 {
		data, err = os.ReadFile(os.Args[1])
	} else {
		data, err = io.ReadAll(os.Stdin)
	}
	if err != nil {
		panic(err)
	}
	input := string(data)
	fmt.Println("Part 1:", part1(input))
	fmt.Println("Part 2:", part2(input))
}
`,
};
