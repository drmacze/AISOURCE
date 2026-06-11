```python
#!/usr/bin/env python3
"""
Code Generation Training Example Generator

This script generates diverse training examples for machine learning models
that perform code generation tasks. It creates examples with varying complexity,
languages, and patterns to help train robust code generation models.

Usage:
    python code_generation_generator.py --output-dir ./training_data --num-examples 1000

Author: AI/ML Engineering Team
Date: 2023
"""

import os
import json
import random
import argparse
from typing import List, Dict, Tuple, Any, Optional
from dataclasses import dataclass
from enum import Enum
import re


class ProgrammingLanguage(Enum):
    """Supported programming languages for code generation."""
    PYTHON = "python"
    JAVASCRIPT = "javascript"
    JAVA = "java"
    CPLUSPLUS = "cpp"
    GO = "go"
    RUST = "rust"


class ComplexityLevel(Enum):
    """Complexity levels for generated code examples."""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


@dataclass
class CodeExample:
    """Represents a single code generation training example."""
    id: str
    language: ProgrammingLanguage
    complexity: ComplexityLevel
    prompt: str
    code: str
    description: str
    tags: List[str]
    difficulty_score: int


class CodeGenerator:
    """Generates diverse code generation training examples."""
    
    def __init__(self, seed: Optional[int] = None):
        """
        Initialize the code generator.
        
        Args:
            seed: Random seed for reproducible results
        """
        if seed is not None:
            random.seed(seed)
        
        # Language-specific templates and patterns
        self._templates = {
            ProgrammingLanguage.PYTHON: {
                'functions': [
                    "def {function_name}({parameters}):",
                    "    \"\"\"{docstring}\"\"\"",
                    "    {implementation}",
                    ""
                ],
                'classes': [
                    "class {class_name}:", 
                    "    def __init__(self{constructor_params}):",
                    "        {constructor_body}",
                    "    ",
                    "    def {method_name}(self{method_params}):",
                    "        {method_body}"
                ],
                'loops': [
                    "for {variable} in {iterable}:",
                    "    {loop_body}",
                    "",
                    "# Alternative with range",
                    "for i in range({range_start}, {range_end}):",
                    "    {range_body}"
                ]
            },
            ProgrammingLanguage.JAVASCRIPT: {
                'functions': [
                    "function {function_name}({parameters}) {",
                    "    {implementation}",
                    "}"
                ],
                'classes': [
                    "class {class_name} {",
                    "    constructor({constructor_params}) {",
                    "        {constructor_body}",
                    "    }",
                    "    ",
                    "    {method_name}({method_params}) {",
                    "        {method_body}",
                    "    }",
                    "}"
                ],
                'loops': [
                    "for (let {variable} of {iterable}) {",
                    "    {loop_body}",
                    "}",
                    "",
                    "// For loop",
                    "for (let i = {range_start}; i < {range_end}; i++) {",
                    "    {range_body}",
                    "}"
                ]
            }
        }
        
        # Common function names and patterns
        self._function_names = [
            "calculate_sum", "find_max", "sort_array", "reverse_string",
            "is_prime", "fibonacci", "merge_lists", "filter_even_numbers",
            "calculate_average", "find_duplicates", "validate_email",
            "encrypt_password", "parse_json", "generate_report"
        ]
        
        self._class_names = [
            "Calculator", "DatabaseManager", "UserValidator", "FileProcessor",
            "DataAnalyzer", "NetworkClient", "CacheManager", "Logger"
        ]
        
        self._variables = [
            "x", "y", "z", "result", "count", "index", "value", "item",
            "data", "items", "array", "list", "temp", "current", "previous"
        ]
        
        self._methods = [
            "process_data", "validate_input", "calculate_result", "format_output",
            "connect_to_database", "send_request", "parse_response", "save_file"
        ]
        
        self._docstrings = [
            "Calculate the sum of two numbers.",
            "Find the maximum value in a list.",
            "Sort an array in ascending order.",
            "Reverse a given string.",
            "Check if a number is prime.",
            "Generate Fibonacci sequence up to n terms.",
            "Merge two sorted lists into one.",
            "Filter even numbers from a list."
        ]
        
        self._tags = [
            "math", "string", "array", "sorting", "algorithm", "validation",
            "file-processing", "database", "network", "security", "utility",
            "data-structure", "recursion", "iteration", "error-handling"
        ]

    def _generate_prompt(self, language: ProgrammingLanguage, complexity: ComplexityLevel) -> str:
        """
        Generate a natural language prompt for code generation.
        
        Args:
            language: Target programming language
            complexity: Complexity level
            
        Returns:
            Natural language prompt
        """
        prompts = {
            ComplexityLevel.EASY: [
                "Write a simple function to calculate the sum of two numbers.",
                "Create a function that reverses a string.",
                "Implement a basic sorting algorithm.",
                "Write a function to check if a number is even.",
                "Create a function that counts vowels in a string."
            ],
            ComplexityLevel.MEDIUM: [
                "Implement a class to manage a shopping cart with add/remove items.",
                "Write a function that finds all duplicate elements in an array.",
                "Create a recursive function to calculate factorial.",
                "Implement a binary search algorithm.",
                "Write a function that validates email addresses."
            ],
            ComplexityLevel.HARD: [
                "Implement a complex data structure like a hash table with collision resolution.",
                "Create a multi-threaded file processor that handles concurrent operations.",
                "Develop a neural network layer implementation from scratch.",
                "Write a system that processes real-time data streams with backpressure.",
                "Implement a secure authentication system with token validation."
            ]
        }
        
        return random.choice(prompts[complexity])

    def _generate_function_code(self, language: ProgrammingLanguage, complexity: ComplexityLevel) -> str:
        """
        Generate function code based on language and complexity.
        
        Args:
            language: Target programming language
            complexity: Complexity level
            
        Returns:
            Generated function code
        """
        template = self._templates[language]['functions']
        
        # Select appropriate parameters based on complexity
        if complexity == ComplexityLevel.EASY:
            params = ["a", "b"]
            impl = "return a + b"
        elif complexity == ComplexityLevel.MEDIUM:
            params = ["numbers"]
            impl = "return sum(numbers)"
        else:  # HARD
            params = ["data", "threshold"]
            impl = "filtered = [x for x in data if x > threshold]\n    return filtered"
        
        # Fill in template
        code_lines = []
        for line in template:
            filled_line = line.format(
                function_name=random.choice(self._function_names),
                parameters=", ".join(params),
                docstring=random.choice(self._docstrings),
                implementation=impl
            )
            code_lines.append(filled_line)
        
        return "\n".join(code_lines)

    def _generate_class_code(self, language: ProgrammingLanguage, complexity: ComplexityLevel) -> str:
        """
        Generate class code based on language and complexity.
        
        Args:
            language: Target programming language
            complexity: Complexity level
            
        Returns:
            Generated class code
        """
        template = self._templates[language]['classes']
        
        # Select appropriate parameters based on complexity
        if complexity == ComplexityLevel.EASY:
            constructor_params = ["self"]
            constructor_body = "pass"
            method_params = ["self"]
            method_body = "return None"
        elif complexity == ComplexityLevel.MEDIUM:
            constructor_params = ["self", "name", "value"]
            constructor_body = "self.name = name\n        self.value = value"
            method_params = ["self", "new_value"]
            method_body = "self.value = new_value"
        else:  # HARD
            constructor_params = ["self", "config"]
            constructor_body = "self.config = config\n        self.cache = {}"
            method_params = ["self", "key", "data"]
            method_body = "self.cache[key] = data\n        return True"
        
        # Fill in template
        code_lines = []
        for line in template:
            filled_line = line.format(
                class_name=random.choice(self._class_names),
                constructor_params=", ".join(constructor_params),
                constructor_body=constructor_body,
                method_name=random.choice(self._methods),
                method_params=", ".join(method_params),
                method_body=method_body
            )
            code_lines.append(filled_line)
        
        return "\n".join(code_lines)

    def _generate_loop_code(self, language: ProgrammingLanguage, complexity: ComplexityLevel) -> str:
        """
        Generate loop code based on language and complexity.
        
        Args:
            language: Target programming language
            complexity: Complexity level
            
        Returns:
            Generated loop code
        """
        template = self._templates[language]['loops']
        
        # Select appropriate parameters based on complexity
        if complexity == ComplexityLevel.EASY:
            variable = random.choice(self._variables)
            iterable = "range(10)"
            loop_body = f"print({variable})"
            range_start = "0"
            range_end = "10"
            range_body = f"print(i)"
        elif complexity == ComplexityLevel.MEDIUM:
            variable = random.choice(self._variables)
            iterable = "my_list"
            loop_body = f"if {variable} % 2 == 0:\n        print({variable})"
            range_start = "0"
            range_end = "5"
            range_body = f"print('Iteration:', i)"
        else:  # HARD
            variable = random.choice(self._variables)
            iterable = "data_stream"
            loop_body = f"processed = process_item({variable})\n        if processed:\n            yield processed"
            range_start = "0"
            range_end = "100"
            range_body = f"if i % 10 == 0:\n            print(f'Progress: {i}%')"
        
        # Fill in template
        code_lines = []
        for line in template:
            filled_line = line.format(
                variable=variable,
                iterable=iterable,
                loop_body=loop_body,
                range_start=range_start,
                range_end=range_end,
                range_body=range_body
            )
            code_lines.append(filled_line)
        
        return "\n".join(code_lines)

    def generate_example(self, example_id: str, language: ProgrammingLanguage, 
                        complexity: ComplexityLevel) -> CodeExample:
        """
        Generate a complete code generation training example.
        
        Args:
            example_id: Unique identifier for the example
            language: Target programming language
            complexity: Complexity level
            
        Returns:
            Generated CodeExample object
        """
        # Select code pattern based on complexity
        if complexity == ComplexityLevel.EASY:
            code_pattern = random.choice(['function', 'loop'])
        elif complexity == ComplexityLevel.MEDIUM:
            code_pattern = random.choice(['function', 'class', 'loop'])
        else:  # HARD
            code_pattern = random.choice(['function', 'class', 'loop'])
        
        # Generate code based on pattern
        if code_pattern == 'function':
            code = self._generate_function_code(language, complexity)
        elif code_pattern == 'class':
            code = self._generate_class_code(language, complexity)
        else:  # loop
            code = self._generate_loop_code(language, complexity)
        
        # Generate prompt
        prompt = self._generate_prompt(language, complexity)
        
        # Generate tags
        num_tags = random.randint(2, 4)
        tags = random.sample(self._tags, num_tags)
        
        # Calculate difficulty score (1-10)
        difficulty_map = {
            ComplexityLevel.EASY: 3,
            ComplexityLevel.MEDIUM: 6,
            ComplexityLevel.HARD: 9
        }
        difficulty_score = difficulty_map[complexity]
        
        return CodeExample(
            id=example_id,
            language=language,
            complexity=complexity,
            prompt=prompt,
            code=code,
            description=f"{complexity.value.title()} complexity {language.value} code example",
            tags=tags,
            difficulty_score=difficulty_score
        )

    def generate_examples(self, count: int, output_dir: str) -> List[CodeExample]:
        """
        Generate multiple training examples.
        
        Args:
            count: Number of examples to generate
            output_dir: Directory to save examples
            
        Returns:
            List of generated CodeExample objects
        """
        examples = []
        
        # Ensure output directory exists
        os.makedirs(output_dir, exist_ok=True)
        
        # Generate examples with different combinations
        languages = list(ProgrammingLanguage)
        complexities = list(ComplexityLevel)
        
        for i in range(count):
            # Randomly select language and complexity
            language = random.choice(languages)
            complexity = random.choice(complexities)
            
            # Generate unique ID
            example_id = f"example_{i+1:04d}_{language.value}_{complexity.value}"
            
            # Generate example
            example = self.generate_example(example_id, language, complexity)
            examples.append(example)
            
            # Save individual JSON file
            filename = os.path.join(output_dir, f"{example_id}.json")
            self._save_example_to_file(example, filename)
        
        # Save summary statistics
        self._save_summary(examples, output_dir)
        
        return examples

    def _save_example_to_file(self, example: CodeExample, filename: