# Synthetic training data for code generation
training_samples = [
    {
        "input": "Write a Python function that calculates the factorial of a number using recursion",
        "output": "def factorial(n):\n    '''Calculate factorial of n using recursion.'''\n    if n < 0:\n        raise ValueError(\"Factorial not defined for negative numbers\")\n    if n == 0 or n == 1:\n        return 1\n    else:\n        return n * factorial(n-1)\n\n# Example usage:\n# print(factorial(5))  # Output: 120"
    },
    {
        "input": "Create a Python class for a bank account with deposit and withdraw methods",
        "output": "class BankAccount:\n    def __init__(self, initial_balance=0):\n        self.balance = initial_balance\n    \n    def deposit(self, amount):\n        if amount <= 0:\n            raise ValueError(\"Deposit amount must be positive\")\n        self.balance += amount\n        return self.balance\n    \n    def withdraw(self, amount):\n        if amount <= 0:\n            raise ValueError(\"Withdrawal amount must be positive\")\n        if amount > self.balance:\n            raise ValueError(\"Insufficient funds\")\n        self.balance -= amount\n        return self.balance\n    \n    def get_balance(self):\n        return self.balance"
    }
]

print(f"Generated {len(training_samples)} training samples")
