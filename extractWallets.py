import re

# Read the data from the file
with open('dune_wallets.txt', 'r') as file:
    data = file.read()

# Extract strings longer than 32 characters
long_strings = re.findall(r'\b\w{33,}\b', data)

# Write the extracted strings to wallets.txt
with open('wallets.txt', 'w') as file:
    for string in long_strings:
        file.write(string + '\n')

print("Strings longer than 32 characters have been written to wallets.txt")
