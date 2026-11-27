package org.seedvault.domain

@JvmInline
value class Grams(val value: Long) : Comparable<Grams> {
    override fun compareTo(other: Grams): Int = value.compareTo(other.value)
    override fun toString(): String = "$value g"
}
