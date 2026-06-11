# Simple script to add clean code generation samples
data_samples = [
    {
        "input": "Write a Python function to calculate factorial of a number",
        "output": "def factorial(n):\n    if n < 0:\n        raise ValueError('Factorial not defined for negative numbers')\n    if n == 0 or n == 1:\n        return 1\n    result = 1\n    for i in range(2, n + 1):\n        result *= i\n    return result"
    },
    {
        "input": "Create a JavaScript function to reverse a string",
        "output": "function reverseString(str) {\n    return str.split('').reverse().join('');\n}"    },
    {
        "input": "Write a Java method to find the maximum element in an array",
        "output": "public static int findMax(int[] arr) {\n    if (arr == null || arr.length == 0) {\n        throw new IllegalArgumentException("Array is empty or null");\n    }\n    int max = arr[0];\n    for (int i = 1; i < arr.length; i++) {\n        if (arr[i] > max) {\n            max = arr[i];\n        }\n    }\n    return max;\n}"    },
    {
        "input": "Implement a Python class for a stack with push, pop, and peek operations",
        "output": "class Stack:\n    def __init__(self):\n        self.items = []\n    \n    def push(self, item):\n        self.items.append(item)\n    \n    def pop(self):\n        if self.is_empty():\n            raise IndexError('pop from empty stack')\n        return self.items.pop()\n    \n    def peek(self):\n        if self.is_empty():\n            raise IndexError('peek from empty stack')\n        return self.items[-1]\n    \n    def is_empty(self):\n        return len(self.items) == 0\n    \n    def size(self):\n        return len(self.items)"
    }
]

print(f"Generated {len(data_samples)} code generation samples")
for i, sample in enumerate(data_samples):
    print(f"Sample {i+1}: {sample['input'][:50]}...")
