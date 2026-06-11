```python
#!/usr/bin/env python3
"""
Code Generation Dataset Builder

This script adds multiple code generation training samples to dataset #2.
It provides a production-ready solution with proper error handling,
type hints, and documentation.

Author: AI/ML Engineering Team
Date: 2023
"""

import json
import logging
import os
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path
import hashlib
import time

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('dataset_builder.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class CodeSample:
    """
    Data class representing a single code generation training sample.
    
    Attributes:
        id (str): Unique identifier for the sample
        language (str): Programming language of the code
        prompt (str): Natural language description of what the code should do
        code (str): Generated code implementation
        complexity (int): Complexity level (1-5)
        tags (List[str]): Tags describing the sample
        created_at (float): Timestamp when sample was created
    """
    id: str
    language: str
    prompt: str
    code: str
    complexity: int
    tags: List[str]
    created_at: float = None
    
    def __post_init__(self):
        """Initialize timestamp if not provided."""
        if self.created_at is None:
            self.created_at = time.time()


class DatasetBuilder:
    """
    Production-ready class for building and managing code generation datasets.
    
    This class handles adding, validating, and saving code generation samples
    to dataset #2 with proper error handling and validation.
    """
    
    def __init__(self, dataset_path: str = "datasets/dataset_2.json"):
        """
        Initialize the DatasetBuilder.
        
        Args:
            dataset_path (str): Path to the dataset file
        """
        self.dataset_path = Path(dataset_path)
        self.dataset_path.parent.mkdir(parents=True, exist_ok=True)
        self.samples: List[Dict[str, Any]] = []
        self._load_dataset()
    
    def _load_dataset(self) -> None:
        """
        Load existing dataset from file if it exists.
        
        Raises:
            IOError: If there's an issue reading the dataset file
        """
        try:
            if self.dataset_path.exists():
                with open(self.dataset_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.samples = data.get('samples', [])
                logger.info(f"Loaded {len(self.samples)} existing samples from {self.dataset_path}")
            else:
                logger.info(f"No existing dataset found at {self.dataset_path}, starting fresh")
                self.samples = []
        except Exception as e:
            logger.error(f"Error loading dataset: {e}")
            raise IOError(f"Failed to load dataset from {self.dataset_path}: {e}")
    
    def _validate_sample(self, sample: CodeSample) -> bool:
        """
        Validate a code sample before adding it to the dataset.
        
        Args:
            sample (CodeSample): The sample to validate
            
        Returns:
            bool: True if valid, False otherwise
            
        Raises:
            ValueError: If validation fails
        """
        errors = []
        
        # Check required fields
        if not sample.language or not isinstance(sample.language, str):
            errors.append("Language must be a non-empty string")
            
        if not sample.prompt or not isinstance(sample.prompt, str):
            errors.append("Prompt must be a non-empty string")
            
        if not sample.code or not isinstance(sample.code, str):
            errors.append("Code must be a non-empty string")
            
        if not isinstance(sample.complexity, int) or sample.complexity < 1 or sample.complexity > 5:
            errors.append("Complexity must be an integer between 1 and 5")
            
        if not isinstance(sample.tags, list):
            errors.append("Tags must be a list")
            
        # Check for duplicate IDs
        if any(s['id'] == sample.id for s in self.samples):
            errors.append(f"Duplicate ID found: {sample.id}")
            
        if errors:
            raise ValueError(f"Validation failed for sample {sample.id}: {'; '.join(errors)}")
            
        return True
    
    def _generate_sample_id(self, prompt: str, language: str) -> str:
        """
        Generate a unique ID for a sample based on its content.
        
        Args:
            prompt (str): The prompt text
            language (str): The programming language
            
        Returns:
            str: A unique identifier for the sample
        """
        content = f"{prompt}_{language}".lower().strip()
        return hashlib.md5(content.encode()).hexdigest()[:12]
    
    def add_sample(self, sample: CodeSample) -> bool:
        """
        Add a single code sample to the dataset.
        
        Args:
            sample (CodeSample): The sample to add
            
        Returns:
            bool: True if successful, False otherwise
            
        Raises:
            ValueError: If sample validation fails
            IOError: If there's an issue saving the dataset
        """
        try:
            # Validate the sample
            self._validate_sample(sample)
            
            # Convert to dictionary format
            sample_dict = {
                'id': sample.id,
                'language': sample.language,
                'prompt': sample.prompt,
                'code': sample.code,
                'complexity': sample.complexity,
                'tags': sample.tags,
                'created_at': sample.created_at
            }
            
            # Add to samples list
            self.samples.append(sample_dict)
            
            # Save to file
            self._save_dataset()
            
            logger.info(f"Successfully added sample {sample.id}")
            return True
            
        except ValueError as e:
            logger.error(f"Validation error for sample {sample.id}: {e}")
            raise
        except Exception as e:
            logger.error(f"Error adding sample {sample.id}: {e}")
            raise IOError(f"Failed to add sample {sample.id}: {e}")
    
    def add_samples(self, samples: List[CodeSample]) -> Tuple[int, int]:
        """
        Add multiple code samples to the dataset.
        
        Args:
            samples (List[CodeSample]): List of samples to add
            
        Returns:
            Tuple[int, int]: (successful_adds, failed_adds)
        """
        successful = 0
        failed = 0
        
        logger.info(f"Adding {len(samples)} samples to dataset")
        
        for i, sample in enumerate(samples):
            try:
                self.add_sample(sample)
                successful += 1
                if i % 10 == 0:  # Log progress every 10 samples
                    logger.info(f"Progress: {i+1}/{len(samples)} samples processed")
            except Exception as e:
                logger.error(f"Failed to add sample {sample.id}: {e}")
                failed += 1
        
        logger.info(f"Added {successful} samples successfully, {failed} failed")
        return successful, failed
    
    def _save_dataset(self) -> None:
        """
        Save the current dataset to file.
        
        Raises:
            IOError: If there's an issue writing to the file
        """
        try:
            dataset_data = {
                'version': '1.0',
                'dataset_id': 'dataset_2',
                'samples': self.samples,
                'total_samples': len(self.samples),
                'last_updated': time.time()
            }
            
            # Write to temporary file first for atomic write
            temp_path = self.dataset_path.with_suffix('.tmp')
            with open(temp_path, 'w', encoding='utf-8') as f:
                json.dump(dataset_data, f, indent=2, ensure_ascii=False)
            
            # Atomic move
            temp_path.replace(self.dataset_path)
            
            logger.info(f"Dataset saved successfully to {self.dataset_path}")
            
        except Exception as e:
            logger.error(f"Error saving dataset: {e}")
            raise IOError(f"Failed to save dataset to {self.dataset_path}: {e}")
    
    def get_sample_count(self) -> int:
        """
        Get the total number of samples in the dataset.
        
        Returns:
            int: Number of samples in the dataset
        """
        return len(self.samples)
    
    def get_samples_by_language(self, language: str) -> List[Dict[str, Any]]:
        """
        Get all samples for a specific programming language.
        
        Args:
            language (str): Programming language filter
            
        Returns:
            List[Dict[str, Any]]: Filtered samples
        """
        return [s for s in self.samples if s['language'].lower() == language.lower()]
    
    def get_samples_by_complexity(self, complexity: int) -> List[Dict[str, Any]]:
        """
        Get all samples with a specific complexity level.
        
        Args:
            complexity (int): Complexity level (1-5)
            
        Returns:
            List[Dict[str, Any]]: Filtered samples
        """
        return [s for s in self.samples if s['complexity'] == complexity]


def create_sample_examples() -> List[CodeSample]:
    """
    Create example code samples for demonstration purposes.
    
    Returns:
        List[CodeSample]: Example samples
    """
    examples = [
        CodeSample(
            id="calc_sum_001",
            language="Python",
            prompt="Write a function that calculates the sum of two numbers",
            code="def calculate_sum(a, b):\n    return a + b\n\n# Example usage\nresult = calculate_sum(5, 3)\nprint(result)",
            complexity=1,
            tags=["basic", "math", "functions"]
        ),
        CodeSample(
            id="sort_list_002",
            language="Python",
            prompt="Create a function to sort a list of integers in ascending order",
            code="def sort_numbers(numbers):\n    return sorted(numbers)\n\n# Example usage\nunsorted = [64, 34, 25, 12, 22, 11, 90]\nsorted_list = sort_numbers(unsorted)\nprint(sorted_list)",
            complexity=2,
            tags=["sorting", "arrays", "algorithms"]
        ),
        CodeSample(
            id="json_parser_003",
            language="JavaScript",
            prompt="Write a JavaScript function to parse JSON data and extract user information",
            code="function parseUserData(jsonString) {\n    try {\n        const data = JSON.parse(jsonString);\n        return {\n            name: data.name,\n            email: data.email,\n            age: data.age\n        };\n    } catch (error) {\n        console.error('Invalid JSON:', error);\n        return null;\n    }\n}\n\n// Example usage\nconst userData = '{\"name\": \"John\", \"email\": \"john@example.com\", \"age\": 30}';\nconsole.log(parseUserData(userData));",
            complexity=3,
            tags=["json", "parsing", "error-handling"]
        ),
        CodeSample(
            id="fibonacci_004",
            language="Python",
            prompt="Implement a recursive Fibonacci function with memoization",
            code="def fibonacci(n, memo={}):\n    if n in memo:\n        return memo[n]\n    if n <= 1:\n        return n\n    memo[n] = fibonacci(n-1, memo) + fibonacci(n-2, memo)\n    return memo[n]\n\n# Example usage\nprint(fibonacci(10))",
            complexity=4,
            tags=["recursion", "dynamic-programming", "algorithms"]
        ),
        CodeSample(
            id="web_scraper_005",
            language="Python",
            prompt="Create a web scraper that extracts headlines from a news website",
            code="import requests\nfrom bs4 import BeautifulSoup\n\ndef scrape_headlines(url):\n    response = requests.get(url)\n    soup = BeautifulSoup(response.content, 'html.parser')\n    headlines = []\n    for headline in soup.find_all('h1', class_='headline'):\n        headlines.append(headline.text.strip())\n    return headlines\n\n# Example usage\n# headlines = scrape_headlines('https://example-news-site.com')\n# print(headlines)",
            complexity=5,
            tags=["web-scraping", "requests", "beautifulsoup"]
        )
    ]
    
    return examples


def main():
    """
    Main function to demonstrate adding code generation samples to dataset #2.
    
    This function creates sample data and adds it to the dataset with proper
    error handling and logging.
    """
    try:
        logger.info("Starting dataset builder for dataset #2")
        
        # Initialize the dataset builder
        builder = DatasetBuilder("datasets/dataset_2.json")
        
        # Create example samples
        logger.info("Creating sample code generation examples...")
        sample_examples = create_sample_examples()
        
        # Add samples to dataset
        logger.info("Adding samples to dataset...")
        successful, failed = builder.add_samples(sample_examples)
        
        # Report results
        logger.info("=" * 50)
        logger.info("DATASET BUILDING SUMMARY")
        logger.info("=" * 50)
        logger.info(f"Total samples attempted: {len(sample_examples)}")
        logger.info(f"Successfully added: {successful}")
        logger.info(f"Failed to add: {failed}")
        logger.info(f"Current dataset size: {builder.get_sample_count()} samples")
        
        # Show some statistics
        python_samples = builder.get_samples_by_language("Python")
        js_samples = builder.get_samples_by_language("JavaScript")
        logger.info(f"Python samples: {len(python_samples)}")
        logger.info(f"JavaScript samples: {len(js_samples)}")
        
        # Verify dataset integrity
        if successful == len(sample_examples):
            logger.info("✅ All samples successfully added to dataset #2")
        else:
            logger.warning("⚠️ Some samples failed to be added to dataset #2")